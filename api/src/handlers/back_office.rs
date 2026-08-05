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

/// The bank's synthetic system customers that own the clearing/settlement
/// float. Keyed by **exact email**, never a `@nano.bank` suffix match:
/// `POST /customers` accepts any address that passes email validation, so a real
/// customer could register `anything@nano.bank` and a `LIKE '%@nano.bank'` filter
/// would fold their balance into the bank's float. These are the same fixed
/// identities the rail/cards/finance handlers key off by constant.
const SYSTEM_CUSTOMER_EMAILS: [&str; 5] = [
    "system@nano.bank",
    "interac@nano.bank",
    "aft@nano.bank",
    "lynx@nano.bank",
    "cash@nano.bank",
];

pub fn back_office_routes() -> Router<AppState> {
    Router::new()
        .route("/ops/float", get(ops_float))
        .route("/ops/transactions", get(ops_transactions))
        .route("/ops/rails", get(ops_rails))
        .route("/ops/exceptions", get(ops_exceptions))
        .route("/ops/cards", get(ops_cards))
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
    /// What `total_float` is and is not. It is a **gross sum** of the system
    /// accounts' balances. Its components are signed per GL convention (clearing
    /// carries the issuer's obligation as a negative; `external_cash` represents
    /// cash *outside* the bank) and are **not economically additive** — read it
    /// as a magnitude, not a net position. Surfaced in the payload so the figure
    /// never travels to the agent without its basis.
    basis: String,
}

const FLOAT_BASIS: &str = "gross sum of system-account balances; components are \
    signed per GL convention (clearing negative, external_cash exogenous) and are \
    not economically additive — a magnitude, not a net position";

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
    let system_emails: Vec<String> = SYSTEM_CUSTOMER_EMAILS.iter().map(|s| s.to_string()).collect();
    let rows = sqlx::query_as::<_, FloatRow>(
        "SELECT c.email AS email, a.account_type::text AS account_type, a.balance AS balance
         FROM accounts a
         JOIN customers c ON c.customer_id = a.customer_id
         WHERE c.email = ANY($1)
         ORDER BY c.email, a.account_type",
    )
    .bind(&system_emails)
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
        basis: FLOAT_BASIS.to_string(),
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

#[derive(sqlx::FromRow)]
struct HoldsRow {
    open_count: i64,
    open_amount: Decimal,
}

/// Authorization holds open **right now**. Point-in-time, NOT windowed: the
/// enclosing response's `window`/`since` do not apply to this field, so the
/// marker travels in the JSON rather than living only in a doc comment the
/// serializer drops. `as_of` is the instant it was read.
#[derive(Serialize)]
struct AuthorizationHolds {
    open_count: i64,
    open_amount: Decimal,
    as_of: DateTime<Utc>,
    basis: String,
}

const HOLDS_BASIS: &str = "point-in-time snapshot of holds open now (released_at \
    IS NULL); not scoped to the response window";

#[derive(Serialize, sqlx::FromRow)]
struct CardTxnGroup {
    transaction_type: String,
    status: String,
    count: i64,
    total: Decimal,
}

#[derive(Serialize)]
struct CardsResponse {
    window: String,
    since: DateTime<Utc>,
    /// Point-in-time (not windowed): authorization holds currently open. The
    /// `as_of`/`basis` fields carry that caveat in the payload itself.
    authorization_holds: AuthorizationHolds,
    /// Card-tagged transactions (`product = 'card'`) over the window.
    card_transactions: Vec<CardTxnGroup>,
}

/// Observable card operations: currently-open authorization holds (a now
/// snapshot) plus card-tagged transactions grouped by type and status over the
/// window. Approval/decline *rates* are intentionally absent — declined
/// authorizations are not persisted as rows today, so a rate cannot be computed
/// without new instrumentation (a later phase).
async fn ops_cards(
    _: AuthenticatedService,
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<CardsResponse>, AppError> {
    let window = q.window.unwrap_or_else(|| "24h".to_string());
    let since = window_cutoff(&window)?;

    let holds = sqlx::query_as::<_, HoldsRow>(
        "SELECT COUNT(*) AS open_count, COALESCE(SUM(amount), 0) AS open_amount
         FROM account_holds
         WHERE released_at IS NULL",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::Database)?;
    let authorization_holds = AuthorizationHolds {
        open_count: holds.open_count,
        open_amount: holds.open_amount,
        as_of: Utc::now(),
        basis: HOLDS_BASIS.to_string(),
    };

    let card_transactions = sqlx::query_as::<_, CardTxnGroup>(
        "SELECT transaction_type,
                status::text AS status,
                COUNT(*) AS count,
                COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE product = 'card' AND created_at >= $1
         GROUP BY transaction_type, status
         ORDER BY transaction_type, status",
    )
    .bind(since)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(CardsResponse {
        window,
        since,
        authorization_holds,
        card_transactions,
    }))
}
