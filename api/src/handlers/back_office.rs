//! Service-plane, read-only operational reads (the "back office" — the COO's
//! perception surface). Bank-wide aggregates with no customer identity; every
//! route requires a service token. The customer-plane handlers are untouched,
//! and no fraud table is ever read here.
use axum::{extract::State, routing::get, Json, Router};
use rust_decimal::Decimal;
use serde::Serialize;

use crate::errors::AppError;
use crate::handlers::AppState;
use crate::middleware::auth::AuthenticatedService;

pub fn back_office_routes() -> Router<AppState> {
    Router::new().route("/ops/float", get(ops_float))
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
