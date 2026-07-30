//! The back-office read plane.
//!
//! Every other read surface in this API answers the question "what may *this*
//! customer see?" — identity comes from the token and the SQL is scoped to
//! `auth.customer_id`. That is right for the consumer app and for the agent
//! plane, and it is why neither can serve a back-office system: a CRM, a support
//! console or an operations dashboard needs to look at a customer it is not.
//!
//! Before this module, a service token reached only the payment rails
//! (`/cards`, `/interac`, `/aft`, `/lynx`, `/finance`, `/fraud/admin`). There
//! was no `GET /customers/:id`, no customer list, and no way to read KYC
//! documents at all. A back-office integration had exactly two options, both
//! bad: hold every customer's password and log in as them, or bypass the API and
//! read PostgreSQL directly.
//!
//! ## What this plane is, precisely
//!
//! **Read-only, and it can read any customer.** That is a genuine escalation
//! over the rails endpoints, which touch only the caller's own settlement flow,
//! and it deserves to be stated rather than discovered:
//!
//! - The service secret is now sufficient to enumerate customers and read their
//!   balances and transaction history. It was already sufficient to move money
//!   on the rails, so this does not widen *who* is trusted — but it does widen
//!   what a leaked secret exposes, from settlement to personal data.
//! - There are **no write endpoints here**, deliberately. Back-office systems
//!   are the classic confused deputy; a plane that can only read cannot be
//!   talked into moving money.
//! - Responses reuse the existing consumer-plane response types, which already
//!   drop `sin` and `date_of_birth`. A back-office caller has no more need of a
//!   social insurance number than the consumer app does.
//!
//! ## What is deliberately absent
//!
//! **Durable audit of reads.** Every handler emits a structured `tracing` event
//! naming the subject, which is greppable and free, but nothing is written to
//! `audit_logs` — the `audit_action` enum has no `read` variant, and adding one
//! is a schema migration that belongs in its own change rather than riding along
//! with a new endpoint. Recorded here so it is a known gap and not an oversight.
//!
//! **Fraud data.** Nothing here reads `suspicious_activities`,
//! `monitoring_rules` or `rule_violations`. Those tables are unused by design:
//! `nano-bank-fraud-engine` owns that data in its own database and withholds
//! scores and reasons so its case surface cannot become a score oracle. Serving
//! them from a back-office plane would rebuild exactly that oracle, since a
//! caller could bisect the model by observing which customers carry cases.

use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::handlers::transactions::fetch_history;
use crate::handlers::AppState;
use crate::middleware::auth::AuthenticatedService;
use crate::models::account::{
    Account, AccountBalanceResponse, AccountResponse, AccountSummary, ActiveHold,
};
use crate::models::customer::{Customer, CustomerResponse, DocumentType, VerificationStatus};
use crate::models::transaction::{TransactionHistoryQuery, TransactionHistoryResponse};

/// Columns shared by every customer read. Mirrors `handlers::customers`.
const CUSTOMER_COLUMNS: &str = "customer_id, email, phone_number, first_name, last_name, \
    date_of_birth, sin, kyc_status, kyc_completed_at, created_at, updated_at";

const ACCOUNT_COLUMNS: &str = "account_id, customer_id, account_number, account_type, currency, \
    balance, available_balance, status, interest_rate, overdraft_limit, minimum_balance, \
    created_at, updated_at, activated_at, closed_at";

pub fn back_office_routes() -> Router<AppState> {
    Router::new()
        .route("/customers", get(list_customers))
        .route("/customers/:customer_id", get(get_customer))
        .route("/customers/:customer_id/accounts", get(list_accounts))
        .route(
            "/customers/:customer_id/kyc-documents",
            get(list_kyc_documents),
        )
        .route("/accounts/:account_id", get(get_account))
        .route("/accounts/:account_id/balance", get(get_balance))
        .route("/accounts/:account_id/transactions", get(get_transactions))
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CustomerSearchQuery {
    /// Exact, case-insensitive match. Email is the identifier back-office
    /// systems actually hold, so this is the join key in practice.
    pub email: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// List or search customers.
///
/// Paginated with the same `limit`/`offset` shape and the same 1..=100 clamp as
/// transaction history, so a caller learns one pagination convention rather than
/// two. Without the clamp this endpoint is a whole-table dump.
async fn list_customers(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Query(q): Query<CustomerSearchQuery>,
) -> Result<Json<Vec<CustomerResponse>>, AppError> {
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let offset = q.offset.unwrap_or(0);

    // Two prepared statements rather than a builder: there are exactly two
    // shapes, and `lower(email) = lower($1)` keeps the search sargable against
    // idx_customers_email only if the index matches — it does not, so this is a
    // scan on large tables. Acceptable for a back-office lookup by exact
    // address; a `citext` column or a functional index is the fix if it matters.
    let customers = match q.email.as_deref() {
        Some(email) => {
            sqlx::query_as::<_, Customer>(&format!(
                "SELECT {CUSTOMER_COLUMNS} FROM customers WHERE lower(email) = lower($1) \
                 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
            ))
            .bind(email)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(&state.pool)
            .await
        }
        None => {
            sqlx::query_as::<_, Customer>(&format!(
                "SELECT {CUSTOMER_COLUMNS} FROM customers \
                 ORDER BY created_at DESC LIMIT $1 OFFSET $2"
            ))
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(&state.pool)
            .await
        }
    }
    .map_err(AppError::Database)?;

    tracing::info!(
        plane = "back_office",
        matched = customers.len(),
        by_email = q.email.is_some(),
        "back-office customer search"
    );

    Ok(Json(customers.into_iter().map(Into::into).collect()))
}

async fn get_customer(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(customer_id): Path<Uuid>,
) -> Result<Json<CustomerResponse>, AppError> {
    let customer = sqlx::query_as::<_, Customer>(&format!(
        "SELECT {CUSTOMER_COLUMNS} FROM customers WHERE customer_id = $1"
    ))
    .bind(customer_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound("Customer not found".to_string()),
        e => AppError::Database(e),
    })?;

    tracing::info!(
        plane = "back_office",
        customer_id = %customer_id,
        "back-office customer read"
    );

    Ok(Json(customer.into()))
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// A customer's accounts.
///
/// Returns the same `AccountSummary` shape as the consumer plane — no
/// `available_balance`, no `created_at`. Keeping the summary narrow means a
/// back-office list view cannot accidentally become the authoritative source for
/// a figure it only half-fetched; callers that need the detail ask for the
/// account.
async fn list_accounts(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(customer_id): Path<Uuid>,
) -> Result<Json<Vec<AccountSummary>>, AppError> {
    let accounts = sqlx::query_as::<_, Account>(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM accounts WHERE customer_id = $1 ORDER BY created_at DESC"
    ))
    .bind(customer_id)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(
        plane = "back_office",
        customer_id = %customer_id,
        accounts = accounts.len(),
        "back-office account list"
    );

    Ok(Json(
        accounts
            .into_iter()
            .map(|a| AccountSummary {
                account_id: a.account_id,
                account_number: a.account_number,
                account_type: a.account_type,
                balance: a.balance,
                currency: a.currency,
                status: a.status,
            })
            .collect(),
    ))
}

/// One account, by id.
///
/// Note the difference from the consumer plane: there is no ownership check,
/// because there is no owner to check against. That is the whole point of the
/// plane and the reason it is read-only.
async fn get_account(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, AppError> {
    let account = load_account(&state, account_id).await?;

    tracing::info!(
        plane = "back_office",
        account_id = %account_id,
        "back-office account read"
    );

    Ok(Json(account.into()))
}

async fn get_balance(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountBalanceResponse>, AppError> {
    let account = load_account(&state, account_id).await?;

    let holds = sqlx::query_as::<_, ActiveHold>(
        "SELECT hold_id, amount, reason, expires_at
         FROM account_holds
         WHERE account_id = $1 AND released_at IS NULL
         ORDER BY created_at DESC",
    )
    .bind(account_id)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(
        plane = "back_office",
        account_id = %account_id,
        "back-office balance read"
    );

    Ok(Json(AccountBalanceResponse {
        account_id: account.account_id,
        account_number: account.account_number,
        balance: account.balance,
        available_balance: account.available_balance,
        currency: account.currency,
        status: account.status,
        holds,
    }))
}

async fn load_account(state: &AppState, account_id: Uuid) -> Result<Account, AppError> {
    sqlx::query_as::<_, Account>(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM accounts WHERE account_id = $1"
    ))
    .bind(account_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound("Account not found".to_string()),
        e => AppError::Database(e),
    })
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/// Transaction history for one account.
///
/// Reuses `fetch_history`, which is always scoped to a `customer_id`'s own
/// accounts. Rather than loosening that function — it is the same scoping the
/// consumer and agent planes depend on, and widening it would weaken all three —
/// this resolves the account's owner first and then pins `account_id` to the one
/// requested. Same guarantee, arrived at from the other direction.
async fn get_transactions(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(account_id): Path<Uuid>,
    Query(mut q): Query<TransactionHistoryQuery>,
) -> Result<Json<TransactionHistoryResponse>, AppError> {
    let account = load_account(&state, account_id).await?;

    // A caller cannot widen the scope by also passing ?account_id= — the path
    // wins, so the query is always for exactly the account named in the URL.
    q.account_id = Some(account_id);

    let history = fetch_history(&state, account.customer_id, q).await?;

    tracing::info!(
        plane = "back_office",
        account_id = %account_id,
        returned = history.transactions.len(),
        "back-office transaction history"
    );

    Ok(Json(history))
}

// ---------------------------------------------------------------------------
// KYC documents
// ---------------------------------------------------------------------------

/// A KYC document, minus the bytes.
///
/// `file_path` is deliberately **not** exposed. It is a pointer into the
/// document store, and a back-office system needs to know a passport was
/// verified — not where the scan of it lives. `notes` and `verified_by` are
/// included because they are what an onboarding case is actually about.
#[derive(Debug, Serialize)]
pub struct KycDocumentResponse {
    pub document_id: Uuid,
    pub document_type: DocumentType,
    pub file_name: String,
    pub verification_status: VerificationStatus,
    pub verified_by: Option<String>,
    pub notes: Option<String>,
    pub uploaded_at: chrono::DateTime<chrono::Utc>,
    pub verified_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct KycDocumentRow {
    document_id: Uuid,
    document_type: DocumentType,
    file_name: String,
    verification_status: VerificationStatus,
    verified_by: Option<String>,
    notes: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    verified_at: Option<chrono::DateTime<chrono::Utc>>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The KYC documents on file for a customer.
///
/// This is the first read path to `kyc_documents` in the API. The table has
/// existed since the initial schema and was reachable only by the upload stub,
/// which returns a plain-text TODO and stores nothing.
async fn list_kyc_documents(
    State(state): State<AppState>,
    _auth: AuthenticatedService,
    Path(customer_id): Path<Uuid>,
) -> Result<Json<Vec<KycDocumentResponse>>, AppError> {
    let rows = sqlx::query_as::<_, KycDocumentRow>(
        "SELECT document_id, document_type, file_name, verification_status,
                verified_by, notes, created_at, verified_at, expires_at
         FROM kyc_documents WHERE customer_id = $1 ORDER BY created_at DESC",
    )
    .bind(customer_id)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(
        plane = "back_office",
        customer_id = %customer_id,
        documents = rows.len(),
        "back-office kyc document read"
    );

    Ok(Json(
        rows.into_iter()
            .map(|r| KycDocumentResponse {
                document_id: r.document_id,
                document_type: r.document_type,
                file_name: r.file_name,
                verification_status: r.verification_status,
                verified_by: r.verified_by,
                notes: r.notes,
                uploaded_at: r.created_at,
                verified_at: r.verified_at,
                expires_at: r.expires_at,
            })
            .collect(),
    ))
}
