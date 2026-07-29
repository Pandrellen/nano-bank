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
//! the same shape as the Interac notification drainer.

use axum::{extract::State, response::Json, routing::post, Router};
use uuid::Uuid;

use crate::errors::AppError;
use crate::handlers::AppState;
use crate::middleware::auth::AuthenticatedService;

/// Attempts before a denial is dead-lettered: left undelivered with its
/// `last_delivery_error`, and no longer claimed.
const MAX_DELIVERY_ATTEMPTS: i32 = 5;
/// Rows claimed per flush — bounds one admin call's work.
const FLUSH_BATCH: i64 = 100;
/// Delivered rows are kept this long for debugging, then purged.
const DELIVERED_RETENTION_DAYS: i32 = 7;
/// Dead-lettered rows are kept longer: they are evidence that delivery is
/// broken, and deleting them quickly would hide the outage that caused them.
const DEAD_LETTER_RETENTION_DAYS: i32 = 30;

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
            "reason": "fraud backend off",
        })));
    }

    let claimed = sqlx::query_as::<_, ClaimedDenial>(
        "UPDATE agent_denial_outbox SET delivery_attempts = delivery_attempts + 1 \
         WHERE outbox_id IN ( \
             SELECT outbox_id FROM agent_denial_outbox \
             WHERE delivered = FALSE AND delivery_attempts < $1 \
             ORDER BY created_at \
             LIMIT $2 \
             FOR UPDATE SKIP LOCKED \
         ) \
         RETURNING outbox_id, payload",
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

    // Retention. The Interac outbox has no purge and grows forever; this one
    // must have it, because `backend = "off"` is the default and means rows
    // accumulate with nothing ever draining them.
    let purged: u64 = sqlx::query(
        "DELETE FROM agent_denial_outbox \
         WHERE (delivered = TRUE \
                AND delivered_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval) \
            OR (delivered = FALSE AND delivery_attempts >= $2 \
                AND created_at < CURRENT_TIMESTAMP - ($3 || ' days')::interval)",
    )
    .bind(DELIVERED_RETENTION_DAYS.to_string())
    .bind(MAX_DELIVERY_ATTEMPTS)
    .bind(DEAD_LETTER_RETENTION_DAYS.to_string())
    .execute(&state.pool)
    .await?
    .rows_affected();

    Ok(Json(serde_json::json!({
        "claimed": claimed_count,
        "delivered": delivered,
        "failed": failed,
        "purged": purged,
    })))
}
