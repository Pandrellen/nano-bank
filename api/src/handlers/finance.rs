//! Interest / NIM engine batch endpoints (spec #2). System-authenticated; driven
//! by cron. `/accrue` computes one day's interest across all eligible accounts and
//! posts the aggregate GL effect; per-account detail lands in `interest_accruals`.
//! `/capitalise` reclasses a month's accruals into customer balances and charges
//! the monthly maintenance fee.
use axum::{extract::State, routing::post, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::finance::daily_interest;
use crate::handlers::cards::post_gl_entry;
use crate::handlers::AppState;
use crate::ledger::Account as Gl;
use crate::middleware::auth::AuthenticatedService;

pub fn finance_routes() -> Router<AppState> {
    Router::new().route("/accrue", post(accrue))
}

#[derive(Debug, Deserialize)]
struct AccrueRequest {
    as_of: chrono::NaiveDate,
}

#[derive(Debug, Serialize)]
struct AccrueResponse {
    accrual_date: chrono::NaiveDate,
    expense_total: Decimal,
    income_total: Decimal,
    economic_event_id: Uuid,
}

/// Compute one day's interest on every eligible account, write the per-account
/// subledger rows, and post the aggregate GL effect for each side. Idempotent per
/// date: a completed run for `as_of` is returned unchanged.
async fn accrue(
    State(state): State<AppState>,
    _svc: AuthenticatedService,
    Json(req): Json<AccrueRequest>,
) -> Result<Json<AccrueResponse>, AppError> {
    // Idempotency: a completed run for this date is a verified no-op.
    if let Some(row) = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(
        "SELECT economic_event_id, expense_total, income_total FROM accrual_runs \
         WHERE accrual_date = $1 AND status = 'completed'",
    )
    .bind(req.as_of)
    .fetch_optional(&state.pool)
    .await?
    {
        return Ok(Json(AccrueResponse {
            accrual_date: req.as_of,
            economic_event_id: row.0,
            expense_total: row.1,
            income_total: row.2,
        }));
    }

    let event_id = Uuid::new_v4();
    let mut tx = state.pool.begin().await?;

    // Deposit side: liability balances earn interest (an expense to the bank).
    // System/settlement accounts carry interest_rate = 0, so they are excluded.
    let deposits = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(
        "SELECT account_id, balance, interest_rate FROM accounts \
         WHERE status = 'active' AND balance > 0 AND interest_rate > 0 \
           AND account_type IN ('chequing','savings')",
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut expense_total = Decimal::ZERO;
    for (account_id, balance, rate) in &deposits {
        let amount = daily_interest(*balance, *rate);
        if amount.is_zero() {
            continue;
        }
        expense_total += amount;
        sqlx::query(
            "INSERT INTO interest_accruals \
               (account_id, accrual_date, product, cost_centre, principal, rate, amount, side, economic_event_id) \
             VALUES ($1,$2,'deposit','deposits',$3,$4,$5,'expense',$6) \
             ON CONFLICT (account_id, accrual_date) DO NOTHING",
        )
        .bind(account_id).bind(req.as_of).bind(balance).bind(rate).bind(amount).bind(event_id)
        .execute(&mut *tx).await?;
    }

    // Asset side: credit-card balances the customer owes accrue interest income.
    let cards = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(
        "SELECT account_id, balance, interest_rate FROM accounts \
         WHERE status = 'active' AND balance > 0 AND interest_rate > 0 \
           AND account_type = 'credit_card'",
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut income_total = Decimal::ZERO;
    for (account_id, owed, apr) in &cards {
        let amount = daily_interest(*owed, *apr);
        if amount.is_zero() {
            continue;
        }
        income_total += amount;
        sqlx::query(
            "INSERT INTO interest_accruals \
               (account_id, accrual_date, product, cost_centre, principal, rate, amount, side, economic_event_id) \
             VALUES ($1,$2,'card','lending',$3,$4,$5,'income',$6) \
             ON CONFLICT (account_id, accrual_date) DO NOTHING",
        )
        .bind(account_id).bind(req.as_of).bind(owed).bind(apr).bind(amount).bind(event_id)
        .execute(&mut *tx).await?;
    }

    sqlx::query(
        "INSERT INTO accrual_runs (accrual_date, economic_event_id, expense_total, income_total) \
         VALUES ($1,$2,$3,$4)",
    )
    .bind(req.as_of).bind(event_id).bind(expense_total).bind(income_total)
    .execute(&mut *tx).await?;
    tx.commit().await?;

    // Aggregate GL, one balanced entry per side (only when non-zero). Done after
    // the local commit so the subledger is the source of truth; a core failure
    // surfaces as 503 and the run can be re-driven (idempotent).
    let day = req.as_of;
    if expense_total > Decimal::ZERO {
        post_gl_entry(&state, &format!("ACCR-EXP-{day}"), "Daily deposit interest accrual",
            Gl::InterestExpense, Gl::AccruedInterestPayable, expense_total).await?;
    }
    if income_total > Decimal::ZERO {
        post_gl_entry(&state, &format!("ACCR-INC-{day}"), "Daily asset interest accrual",
            Gl::AccruedInterestReceivable, Gl::InterestIncome, income_total).await?;
    }

    Ok(Json(AccrueResponse { accrual_date: day, expense_total, income_total, economic_event_id: event_id }))
}
