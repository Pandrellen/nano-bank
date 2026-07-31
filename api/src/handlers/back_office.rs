//! Service-plane, read-only operational reads (the "back office" — the COO's
//! perception surface). Bank-wide aggregates with no customer identity; every
//! route requires a service token. The customer-plane handlers are untouched,
//! and no fraud table is ever read here.
use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::config::database::DatabasePool;
use crate::errors::AppError;
use crate::handlers::AppState;
use crate::middleware::auth::AuthenticatedService;

pub fn back_office_routes() -> Router<AppState> {
    Router::new()
        .route("/ops/float", get(ops_float))
        .route("/ops/transactions", get(ops_transactions))
        .route("/ops/rails", get(ops_rails))
        .route("/ops/exceptions", get(ops_exceptions))
}

#[derive(Serialize)]
struct FloatAccount {
    system: String,       // interac | aft | lynx | system | cash
    role: String,         // clearing | settlement | external_cash | other
    account_type: String, // chequing | savings | ...
    balance: Decimal,
}

#[derive(Serialize)]
struct FloatResponse {
    accounts: Vec<FloatAccount>,
    total_float: Decimal,
}

#[derive(sqlx::FromRow)]
struct FloatRow {
    email: String,
    account_type: String,
    balance: Decimal,
}

/// The clearing/settlement float: balances of the synthetic system customers'
/// accounts (`*@nano.bank`). `chequing`->clearing, `savings`->settlement, except
/// `cash@nano.bank`'s chequing which is EXTERNAL_CASH.
async fn ops_float(
    _: AuthenticatedService,
    State(state): State<AppState>,
) -> Result<Json<FloatResponse>, AppError> {
    let rows = sqlx::query_as::<_, FloatRow>(
        "SELECT c.email AS email, a.account_type::text AS account_type, a.balance AS balance
         FROM accounts a
         JOIN customers c ON c.customer_id = a.customer_id
         WHERE c.email LIKE '%@nano.bank'
         ORDER BY c.email, a.account_type",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    let mut accounts = Vec::with_capacity(rows.len());
    let mut total = Decimal::ZERO;
    for r in rows {
        let system = r.email.split('@').next().unwrap_or("").to_string();
        let role = match (system.as_str(), r.account_type.as_str()) {
            ("cash", _) => "external_cash",
            (_, "chequing") => "clearing",
            (_, "savings") => "settlement",
            _ => "other",
        }
        .to_string();
        total += r.balance;
        accounts.push(FloatAccount {
            system,
            role,
            account_type: r.account_type,
            balance: r.balance,
        });
    }
    Ok(Json(FloatResponse {
        accounts,
        total_float: total,
    }))
}

#[derive(Deserialize)]
struct WindowQuery {
    window: Option<String>,
}

/// Map a window shorthand to a cutoff instant. Unknown windows are a 400 so the
/// caller learns the vocabulary rather than getting silent 24h data.
fn window_cutoff(window: &str) -> Result<DateTime<Utc>, AppError> {
    let dur = match window {
        "24h" => Duration::hours(24),
        "7d" => Duration::days(7),
        "30d" => Duration::days(30),
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported window '{other}' (use 24h|7d|30d)"
            )))
        }
    };
    Ok(Utc::now() - dur)
}

#[derive(Serialize, sqlx::FromRow)]
struct TxnGroup {
    transaction_type: String,
    status: String,
    count: i64,
    total: Decimal,
}

#[derive(Serialize)]
struct TransactionsResponse {
    window: String,
    since: DateTime<Utc>,
    groups: Vec<TxnGroup>,
}

/// Bank-wide transaction counts + amounts grouped by type and status over a
/// window. Read-only aggregate; no customer scoping.
async fn ops_transactions(
    _: AuthenticatedService,
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<TransactionsResponse>, AppError> {
    let window = q.window.unwrap_or_else(|| "24h".to_string());
    let since = window_cutoff(&window)?;
    let groups = sqlx::query_as::<_, TxnGroup>(
        "SELECT transaction_type,
                status::text AS status,
                COUNT(*) AS count,
                COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE created_at >= $1
         GROUP BY transaction_type, status
         ORDER BY transaction_type, status",
    )
    .bind(since)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(TransactionsResponse {
        window,
        since,
        groups,
    }))
}

#[derive(Serialize, sqlx::FromRow)]
struct RailGroup {
    status: String,
    count: i64,
    total: Decimal,
}

#[derive(Serialize)]
struct RailsBreakdown {
    interac: Vec<RailGroup>,
    aft: Vec<RailGroup>,
    lynx: Vec<RailGroup>,
}

#[derive(Serialize)]
struct RailsResponse {
    window: String,
    since: DateTime<Utc>,
    rails: RailsBreakdown,
}

/// Count + summed amount grouped by status for one rail table over a window.
/// `table` is always a hardcoded literal below (never user input), so the
/// interpolation is safe; the window value is bound.
async fn rail_groups(
    pool: &DatabasePool,
    table: &str,
    since: DateTime<Utc>,
) -> Result<Vec<RailGroup>, AppError> {
    let sql = format!(
        "SELECT status::text AS status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM {table}
         WHERE created_at >= $1
         GROUP BY status
         ORDER BY status"
    );
    sqlx::query_as::<_, RailGroup>(&sql)
        .bind(since)
        .fetch_all(pool)
        .await
        .map_err(AppError::Database)
}

/// Per-rail activity (Interac / AFT / Lynx) grouped by status over a window —
/// the throughput/backlog signal the COO reads. Read-only aggregate.
async fn ops_rails(
    _: AuthenticatedService,
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<RailsResponse>, AppError> {
    let window = q.window.unwrap_or_else(|| "24h".to_string());
    let since = window_cutoff(&window)?;
    let interac = rail_groups(&state.pool, "interac_etransfers", since).await?;
    let aft = rail_groups(&state.pool, "aft_entries", since).await?;
    let lynx = rail_groups(&state.pool, "lynx_wires", since).await?;
    Ok(Json(RailsResponse {
        window,
        since,
        rails: RailsBreakdown { interac, aft, lynx },
    }))
}

#[derive(Serialize)]
struct ExceptionCounts {
    failed_transactions: i64,
    reversals: i64,
    returned_aft_entries: i64,
    rejected_aft_entries: i64,
    wire_recalls: i64,
}

#[derive(Serialize)]
struct ExceptionsResponse {
    window: String,
    since: DateTime<Utc>,
    exceptions: ExceptionCounts,
}

async fn count_since(
    pool: &DatabasePool,
    sql: &str,
    since: DateTime<Utc>,
) -> Result<i64, AppError> {
    sqlx::query_scalar::<_, i64>(sql)
        .bind(since)
        .fetch_one(pool)
        .await
        .map_err(AppError::Database)
}

/// Counts of the operational exceptions the ledger actually **records** over a
/// window: failed transactions, reversals, returned/rejected AFT entries, and
/// Lynx wire recalls. Note: declined authorizations and NSF-at-authorization are
/// not persisted as rows today, so they are not (and cannot yet be) counted here
/// — surfacing them would need new instrumentation (a later phase).
async fn ops_exceptions(
    _: AuthenticatedService,
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<ExceptionsResponse>, AppError> {
    let window = q.window.unwrap_or_else(|| "24h".to_string());
    let since = window_cutoff(&window)?;
    let p = &state.pool;
    let exceptions = ExceptionCounts {
        failed_transactions: count_since(
            p,
            "SELECT COUNT(*) FROM transactions WHERE status = 'failed' AND created_at >= $1",
            since,
        )
        .await?,
        reversals: count_since(
            p,
            "SELECT COUNT(*) FROM transaction_reversals WHERE created_at >= $1",
            since,
        )
        .await?,
        returned_aft_entries: count_since(
            p,
            "SELECT COUNT(*) FROM aft_entries WHERE status = 'returned' AND created_at >= $1",
            since,
        )
        .await?,
        rejected_aft_entries: count_since(
            p,
            "SELECT COUNT(*) FROM aft_entries WHERE status = 'rejected' AND created_at >= $1",
            since,
        )
        .await?,
        wire_recalls: count_since(
            p,
            "SELECT COUNT(*) FROM lynx_recalls WHERE created_at >= $1",
            since,
        )
        .await?,
    };
    Ok(Json(ExceptionsResponse {
        window,
        since,
        exceptions,
    }))
}
