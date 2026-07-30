//! Integration tests for the back-office read plane (`/api/v1/back-office/*`).
//!
//! Same harness as `tests/agents.rs` and `tests/finance.rs`: every test probes
//! `GET /health` and **skips (still passes)** when the API isn't running. These
//! need only the API and Postgres — nothing here writes, so no GL core is
//! involved.
//!
//! ```bash
//! cd api && cargo test --test back_office -- --nocapture
//! ```
//! Override the base URL with `NANO_BANK_TEST_URL`.
//!
//! The tests that matter most are the plane guard ones. This plane can read any
//! customer, so the only thing standing between a consumer token and everybody
//! else's balances is `AuthenticatedService` — and a guard nobody tests is a
//! guard that quietly stops working.

use serde_json::{json, Value};
use uuid::Uuid;

const TEST_PASSWORD: &str = "securepass123";
const SERVICE_SECRET: &str = "nano-bank-visa-network-secret-change-me";

fn base_url() -> String {
    std::env::var("NANO_BANK_TEST_URL").unwrap_or_else(|_| "http://localhost:8081".to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn stack_up(c: &reqwest::Client) -> bool {
    matches!(
        c.get(format!("{}/health", base_url())).send().await,
        Ok(r) if r.status().is_success()
    )
}

macro_rules! require_stack {
    ($c:expr) => {
        if !stack_up($c).await {
            eprintln!("SKIP: nano-bank not reachable at {}", base_url());
            return;
        }
    };
}

fn bo(path: &str) -> String {
    format!("{}/api/v1/back-office{}", base_url(), path)
}

async fn create_customer(c: &reqwest::Client) -> (Uuid, String) {
    let n = Uuid::new_v4().as_u128();
    let email = format!("botest_{}@example.com", n % 1_000_000_000);
    let body = json!({
        "email": email,
        "phone_number": format!("{:010}", (n % 10_000_000_000u128)),
        "first_name": "Back",
        "last_name": "Office",
        "date_of_birth": "1990-01-01",
        "sin": format!("{:09}", n % 1_000_000_000),
        "password": TEST_PASSWORD
    });
    let resp = c
        .post(format!("{}/api/v1/customers", base_url()))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "create customer: {}",
        resp.status()
    );
    let v: Value = resp.json().await.unwrap();
    let id = Uuid::parse_str(v["customer_id"].as_str().unwrap()).unwrap();
    (id, email)
}

async fn login(c: &reqwest::Client, email: &str) -> String {
    let resp = c
        .post(format!("{}/api/v1/auth/login", base_url()))
        .json(&json!({ "email": email, "password": TEST_PASSWORD }))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "login: {}", resp.status());
    let v: Value = resp.json().await.unwrap();
    v["access_token"].as_str().unwrap().to_string()
}

async fn service_token(c: &reqwest::Client) -> String {
    let resp = c
        .post(format!("{}/api/v1/auth/service-token", base_url()))
        .json(&json!({ "client_secret": SERVICE_SECRET }))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "service-token: {}",
        resp.status()
    );
    let v: Value = resp.json().await.unwrap();
    v["access_token"].as_str().unwrap().to_string()
}

async fn create_account(c: &reqwest::Client, token: &str, account_type: &str) -> Uuid {
    let resp = c
        .post(format!("{}/api/v1/accounts", base_url()))
        .bearer_auth(token)
        .json(&json!({ "account_type": account_type }))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "create account: {}",
        resp.status()
    );
    let v: Value = resp.json().await.unwrap();
    Uuid::parse_str(v["account_id"].as_str().unwrap()).unwrap()
}

/// A customer plus one chequing account, and both tokens.
async fn fixture(c: &reqwest::Client) -> (Uuid, Uuid, String, String) {
    let (customer_id, email) = create_customer(c).await;
    let customer_token = login(c, &email).await;
    let account_id = create_account(c, &customer_token, "chequing").await;
    let svc = service_token(c).await;
    (customer_id, account_id, customer_token, svc)
}

// ---------------------------------------------------------------------------
// The plane guard
// ---------------------------------------------------------------------------

/// A customer token must be refused on every back-office route.
///
/// Enumerated rather than spot-checked: the failure mode is one route added
/// later with the wrong extractor, and a test that samples two of seven will
/// not see it.
#[tokio::test]
async fn customer_tokens_are_refused_on_every_route() {
    let c = client();
    require_stack!(&c);

    let (customer_id, account_id, customer_token, _svc) = fixture(&c).await;

    let routes = [
        bo("/customers"),
        bo(&format!("/customers/{customer_id}")),
        bo(&format!("/customers/{customer_id}/accounts")),
        bo(&format!("/customers/{customer_id}/kyc-documents")),
        bo(&format!("/accounts/{account_id}")),
        bo(&format!("/accounts/{account_id}/balance")),
        bo(&format!("/accounts/{account_id}/transactions")),
    ];

    for url in routes {
        let resp = c
            .get(&url)
            .bearer_auth(&customer_token)
            .send()
            .await
            .unwrap();

        // 403, not 401: the token is valid, it is simply the wrong plane. That
        // is the same distinction the card rails already draw.
        assert_eq!(
            resp.status(),
            403,
            "a customer token reached {url} — the plane guard is not holding"
        );
    }
}

#[tokio::test]
async fn unauthenticated_requests_are_refused() {
    let c = client();
    require_stack!(&c);

    let resp = c.get(bo("/customers")).send().await.unwrap();
    assert_eq!(resp.status(), 401);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_service_token_reads_any_customer() {
    let c = client();
    require_stack!(&c);

    let (customer_id, _account, _cust, svc) = fixture(&c).await;

    let resp = c
        .get(bo(&format!("/customers/{customer_id}")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "status {}", resp.status());

    let v: Value = resp.json().await.unwrap();
    assert_eq!(v["customer_id"].as_str().unwrap(), customer_id.to_string());

    // The response type drops these. A back-office system has no more need of a
    // social insurance number than the consumer app does.
    assert!(v.get("sin").is_none(), "sin must never be exposed");
    assert!(v.get("date_of_birth").is_none());
}

#[tokio::test]
async fn an_unknown_customer_is_404() {
    let c = client();
    require_stack!(&c);

    let svc = service_token(&c).await;
    let resp = c
        .get(bo(&format!("/customers/{}", Uuid::new_v4())))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn customers_are_searchable_by_email() {
    let c = client();
    require_stack!(&c);

    let (customer_id, email) = create_customer(&c).await;
    let svc = service_token(&c).await;

    // Email is the only identifier a back-office system reliably holds, so this
    // is the join key in practice.
    let v: Value = c
        .get(bo(&format!("/customers?email={email}")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let rows = v.as_array().expect("expected an array");
    assert_eq!(rows.len(), 1, "expected exactly one match for {email}");
    assert_eq!(
        rows[0]["customer_id"].as_str().unwrap(),
        customer_id.to_string()
    );
}

#[tokio::test]
async fn the_customer_list_clamps_its_limit() {
    let c = client();
    require_stack!(&c);

    let svc = service_token(&c).await;

    // Without the clamp this endpoint is a whole-table dump, which is a very
    // different thing to hand a back-office integration.
    let v: Value = c
        .get(bo("/customers?limit=100000"))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(v.as_array().unwrap().len() <= 100);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[tokio::test]
async fn accounts_are_listed_for_any_customer() {
    let c = client();
    require_stack!(&c);

    let (customer_id, account_id, _cust, svc) = fixture(&c).await;

    let v: Value = c
        .get(bo(&format!("/customers/{customer_id}/accounts")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let rows = v.as_array().unwrap();
    assert!(rows
        .iter()
        .any(|a| a["account_id"].as_str().unwrap() == account_id.to_string()));

    // The list is a summary, matching the consumer plane: no available_balance.
    // Keeping it narrow stops a list view becoming the authoritative source for
    // a figure it only half-fetched.
    assert!(rows[0].get("available_balance").is_none());
}

#[tokio::test]
async fn money_is_still_serialised_as_a_string() {
    let c = client();
    require_stack!(&c);

    let (_customer, account_id, _cust, svc) = fixture(&c).await;

    let v: Value = c
        .get(bo(&format!("/accounts/{account_id}/balance")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    // Downstream consumers parse this as a decimal string. If rust_decimal ever
    // gains `serde-float`, every one of them starts silently rounding.
    assert!(
        v["balance"].is_string(),
        "balance should be a string, got {:?}",
        v["balance"]
    );
    assert!(v["holds"].is_array());
}

#[tokio::test]
async fn an_unknown_account_is_404() {
    let c = client();
    require_stack!(&c);

    let svc = service_token(&c).await;
    for suffix in ["", "/balance", "/transactions"] {
        let resp = c
            .get(bo(&format!("/accounts/{}{suffix}", Uuid::new_v4())))
            .bearer_auth(&svc)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404, "unknown account{suffix}");
    }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

#[tokio::test]
async fn transaction_history_is_pinned_to_the_path_account() {
    let c = client();
    require_stack!(&c);

    let (_customer, account_id, customer_token, svc) = fixture(&c).await;
    let other = create_account(&c, &customer_token, "savings").await;

    // Passing ?account_id= for a *different* account must not widen the scope:
    // the path wins. Otherwise the URL stops describing what it returns.
    let v: Value = c
        .get(bo(&format!(
            "/accounts/{account_id}/transactions?account_id={other}"
        )))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    for txn in v["transactions"].as_array().unwrap() {
        let touches_path_account = txn["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["account_id"].as_str().unwrap() == account_id.to_string());
        assert!(
            touches_path_account,
            "history leaked a transaction that does not touch {account_id}"
        );
    }
}

#[tokio::test]
async fn transaction_history_has_the_pagination_envelope() {
    let c = client();
    require_stack!(&c);

    let (_customer, account_id, _cust, svc) = fixture(&c).await;

    let v: Value = c
        .get(bo(&format!("/accounts/{account_id}/transactions?limit=5")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    // The same envelope as the consumer plane, so a caller learns one shape.
    assert!(v["transactions"].is_array());
    assert!(v["total_count"].is_number());
    assert!(v["has_more"].is_boolean());
}

// ---------------------------------------------------------------------------
// KYC documents
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kyc_documents_are_readable_and_omit_the_file_path() {
    let c = client();
    require_stack!(&c);

    let (customer_id, _account, _cust, svc) = fixture(&c).await;

    let resp = c
        .get(bo(&format!("/customers/{customer_id}/kyc-documents")))
        .bearer_auth(&svc)
        .send()
        .await
        .unwrap();

    // A fresh customer has none — the point is that the route answers at all.
    // Before this plane, `kyc_documents` had no read path in the API.
    assert!(resp.status().is_success(), "status {}", resp.status());

    let v: Value = resp.json().await.unwrap();
    for doc in v.as_array().unwrap() {
        // A back-office system needs to know a passport was verified, not where
        // the scan of it lives.
        assert!(
            doc.get("file_path").is_none(),
            "file_path must not be exposed"
        );
    }
}
