//! Drains the agent-denial outbox to the fraud engine.
//!
//! Every `agent_actions` row that is not `allowed` is mirrored into
//! `agent_denial_outbox` by the same statement that writes the audit (the CTE in
//! `policy.rs`), so the telemetry and the record it describes commit together.
//! This module is the other end: it claims undelivered rows and POSTs them to
//! the engine's `/v1/outcomes`.
//!
//! Why the bank pushes rather than the engine pulling: the engine has no access
//! to this database, and never will — the integration is HTTP-only by design.
//!
//! The API runs zero background workers by design, so the drain is an admin
//! endpoint poked on a schedule (see `k8s/fraud-denial-drainer-cronjob.yaml`),
//! the same shape as the Interac notification drainer — and now literally the
//! same claim, which both take from [`crate::outbox::OutboxClaim`].

use axum::{extract::State, response::Json, routing::post, Router};
use uuid::Uuid;

use crate::config::database::DatabasePool;
use crate::errors::AppError;
use crate::handlers::AppState;
use crate::middleware::auth::AuthenticatedService;
use crate::outbox::OutboxClaim;

/// Attempts before a denial is dead-lettered: left undelivered with its
/// `last_delivery_error`, and no longer claimed.
const MAX_DELIVERY_ATTEMPTS: i32 = 5;
/// Rows claimed per flush — bounds one admin call's work.
const FLUSH_BATCH: i64 = 100;
/// Delivered rows are kept this long for debugging, then purged.
const DELIVERED_RETENTION_DAYS: i32 = 7;
/// Undelivered rows are kept longer, counted from creation and **regardless of
/// attempt count**. Dead-lettered rows are evidence that delivery is broken and
/// deleting them quickly would hide the outage; rows that were never attempted
/// at all (the `backend = "off"` default) are the same problem seen from the
/// other side. One window covers both, and covers the rows in between — a
/// partly-attempted row this old means nothing is draining either.
///
/// It is longer than the delivered window on purpose: enabling the backend
/// after a break should find a recent backlog to flush, not a hole.
const UNDELIVERED_RETENTION_DAYS: i32 = 30;

pub fn fraud_admin_routes() -> Router<AppState> {
    Router::new().route("/admin/flush-denials", post(flush_denials))
}

#[derive(sqlx::FromRow)]
struct ClaimedDenial {
    outbox_id: Uuid,
    payload: serde_json::Value,
}

/// Drain the agent-denial outbox (admin plane, service token).
///
/// The claim is an atomic `delivery_attempts += 1` under `FOR UPDATE SKIP
/// LOCKED`, so concurrent drainers or multiple API replicas never grab the same
/// row, and a claim that dies mid-send costs one attempt rather than stranding
/// an in-flight state.
///
/// **Delivery is at-least-once**, and that is safe here precisely because the
/// payload carries `event_key` derived from `action_id`: the engine's outcome
/// ingestion is idempotent on it, so a redelivery collapses into the original
/// event instead of double-counting a denial.
async fn flush_denials(
    State(state): State<AppState>,
    _svc: AuthenticatedService,
) -> Result<Json<serde_json::Value>, AppError> {
    // Retention runs first, and unconditionally. The table grows fastest in
    // exactly the configuration that never reaches the delivery loop below —
    // `backend = "off"` is the default, and every denial still lands in the
    // outbox — so a purge that only runs when draining is enabled is a purge
    // that never runs on the deployments that need it.
    let purged = purge_expired(&state.pool).await?;

    // With screening off there is no engine to talk to. Skip without claiming:
    // claiming would burn the retry budget of every row against a backend
    // nobody asked us to call, dead-lettering the lot before it is ever enabled.
    if state.fraud.backend() == "off" {
        let pending: i64 =
            sqlx::query_scalar("SELECT count(*) FROM agent_denial_outbox WHERE delivered = FALSE")
                .fetch_one(&state.pool)
                .await?;
        return Ok(Json(serde_json::json!({
            "skipped": pending,
            "purged": purged,
            "reason": "fraud backend off",
        })));
    }

    let claimed = sqlx::query_as::<_, ClaimedDenial>(
        &OutboxClaim {
            table: "agent_denial_outbox",
            id_column: "outbox_id",
            returning: "outbox_id, payload",
        }
        .sql(),
    )
    .bind(MAX_DELIVERY_ATTEMPTS)
    .bind(FLUSH_BATCH)
    .fetch_all(&state.pool)
    .await?;

    let claimed_count = claimed.len() as i64;
    let mut delivered = 0i64;
    let mut failed = 0i64;

    for row in claimed {
        match state.fraud.report_denial(&row.payload).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE agent_denial_outbox \
                     SET delivered = TRUE, delivered_at = CURRENT_TIMESTAMP, \
                         last_delivery_error = NULL \
                     WHERE outbox_id = $1",
                )
                .bind(row.outbox_id)
                .execute(&state.pool)
                .await?;
                delivered += 1;
            }
            Err(err) => {
                // Leave delivered = FALSE (the attempt is already counted): it
                // retries next flush until the budget is spent, then dead-letters.
                sqlx::query(
                    "UPDATE agent_denial_outbox SET last_delivery_error = $2 \
                     WHERE outbox_id = $1",
                )
                .bind(row.outbox_id)
                .bind(err.to_string())
                .execute(&state.pool)
                .await?;
                failed += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "claimed": claimed_count,
        "delivered": delivered,
        "failed": failed,
        "purged": purged,
    })))
}

/// Drop outbox rows past their retention window. The Interac outbox has no
/// purge and grows forever; this one must have it.
///
/// Two predicates, split on the only thing that changes the window: whether the
/// row ever reached the engine. Delivered rows are debugging residue and go
/// early; undelivered ones are kept the full window from creation whatever
/// their attempt count, because "never attempted", "mid-retry" and
/// "dead-lettered" are all the same condition — nothing is draining — and
/// deserve the same grace period.
async fn purge_expired(pool: &DatabasePool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "DELETE FROM agent_denial_outbox \
         WHERE (delivered = TRUE \
                AND delivered_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval) \
            OR (delivered = FALSE \
                AND created_at < CURRENT_TIMESTAMP - ($2 || ' days')::interval)",
    )
    .bind(DELIVERED_RETENTION_DAYS.to_string())
    .bind(UNDELIVERED_RETENTION_DAYS.to_string())
    .execute(pool)
    .await?
    .rows_affected())
}
