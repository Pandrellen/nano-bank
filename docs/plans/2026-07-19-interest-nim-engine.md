# Interest / NIM Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn nano-bank's balances × rates into real GL postings over time — daily interest accrual on both sides, monthly capitalisation, inline interchange and fee income — and formalise the economics tag columns.

**Architecture:** A new `finance` area in nano-bank (`api/src/handlers/finance.rs` + `api/src/finance/` for testable logic) exposes two system-authenticated batch endpoints (`/accrue` daily, `/capitalise` monthly). Interest accrues daily into two new accrued-interest holding GL accounts and is capitalised monthly into customer balances; interchange and the e-transfer fee are recognized inline in the existing card `capture` and `send_etransfer` handlers. Every posting is attributable through tag columns (`product`, `cost_centre`, `economic_event_id`) on `transactions` and on the local `interest_accruals` subledger.

**Tech Stack:** Rust / axum, sqlx (Postgres), `rust_decimal::Decimal`. The swappable `Ledger` port (`api/src/ledger/mod.rs`) posts aggregate GL to the modern (Rust) or legacy (Java) core. Spans three repos: `nano-bank`, `nano-bank-modern-core`, `nano-bank-legacy-core`.

## Global Constraints

- Money is always `rust_decimal::Decimal`; never `f64`. Round to 2 dp with `.round_dp(2)`.
- Day-count convention: **ACT/365**, simple daily interest on end-of-day balance.
- Rounding rule: round **per-account per-day** to the cent; each day's aggregate GL amount is the **sum of the rounded per-account amounts** (GL total == subledger total, no drift).
- Default rates (config-tunable, not hard business policy): interchange **150 bps**, e-transfer fee **$1.50**, monthly maintenance fee **$4.00**, maintenance waiver at balance **≥ $3000**.
- DB host is **`::1`** (IPv6 loopback), not `127.0.0.1`.
- Do **not** edit `api/src/handlers/transactions.rs` (owned by open PR #15).
- The legacy core's cryptic identifiers (`ska1`, `skb1`, `saknr`, `xbilk`, `ktoks`, `xopvw`, `bukrs`, `ktopl`) are neutral technical names — **do not describe in code or docs what product they resemble.**
- Never `pkill -f 'target/debug/nano-bank-api'` (kills the launching shell). Kill the listener by PID from `ss -ltnp | grep ':8081'`.
- For podman/docker/kubectl visibility from this shell: `export XDG_RUNTIME_DIR=/run/user/1000 XDG_DATA_HOME=/home/bmartins/.local/share`.
- New GL accounts introduced here (spec #2 owns them):

  | Port role | modern `code` / `kind` | legacy `saknr` / `xbilk` / `ktoks` |
  |---|---|---|
  | `AccruedInterestReceivable` | `ACCR_INT_RECV` / asset     | `0000141900` / TRUE / `RECV` |
  | `AccruedInterestPayable`    | `ACCR_INT_PAY` / liability  | `0000220000` / TRUE / `PAYB` |

- Branches: `nano-bank` on `finance-nim-engine` (already created off `finance-gl-chart`); create `finance-nim-engine` off `origin/main` in each core repo when its task starts.

---

### Task 1: Ledger port — two accrued-interest account roles

**Files:**
- Modify: `api/src/ledger/mod.rs` (enum `Account`, `modern_code()`, `legacy_account()`, the `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `Account::AccruedInterestReceivable`, `Account::AccruedInterestPayable` (serde snake_case: `accrued_interest_receivable`, `accrued_interest_payable`); `.modern_code()` → `ACCR_INT_RECV` / `ACCR_INT_PAY`; `.legacy_account()` → `0000141900` / `0000220000`.

- [ ] **Step 1: Extend the stability test (write the failing assertions first)**

In `api/src/ledger/mod.rs`, inside `mod tests`, add two rows to the `cases` array in `account_mappings_are_stable`:

```rust
            (Account::AccruedInterestReceivable, "ACCR_INT_RECV", "0000141900"),
            (Account::AccruedInterestPayable, "ACCR_INT_PAY", "0000220000"),
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cargo test -p nano-bank-api --bins ledger::tests`
Expected: FAIL — `no variant named AccruedInterestReceivable found for enum Account`.

- [ ] **Step 3: Add the two enum variants**

In `enum Account`, after `OperatingExpense`, add:

```rust
    AccruedInterestReceivable,
    AccruedInterestPayable,
```

- [ ] **Step 4: Add the `modern_code()` arms**

In `fn modern_code`, add arms (the `match` is exhaustive — the compiler requires them):

```rust
            Account::AccruedInterestReceivable => "ACCR_INT_RECV",
            Account::AccruedInterestPayable => "ACCR_INT_PAY",
```

- [ ] **Step 5: Add the `legacy_account()` arms**

In `fn legacy_account`, add:

```rust
            Account::AccruedInterestReceivable => "0000141900",
            Account::AccruedInterestPayable => "0000220000",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p nano-bank-api --bins ledger::tests`
Expected: PASS — `test result: ok. 2 passed`.

- [ ] **Step 7: Commit**

```bash
git add api/src/ledger/mod.rs
git commit -m "feat(ledger): add accrued-interest holding account roles"
```

---

### Task 2: Modern core seed — two accrued-interest GL accounts

**Repo:** `nano-bank-modern-core` (separate repo). Start: `git checkout -b finance-nim-engine origin/main`.

**Files:**
- Modify: `resources/seed.sql` (the single `gl_account` INSERT)
- Modify: `scripts/verify-seed.sh` (assert the two new codes)

**Interfaces:**
- Produces: `gl_account` rows for codes `ACCR_INT_RECV` (kind `asset`) and `ACCR_INT_PAY` (kind `liability`).

- [ ] **Step 1: Add the two rows to the `gl_account` INSERT**

In `resources/seed.sql`, add these rows inside the existing `INSERT INTO gl_account (...) VALUES ...` value list (keep them inside the one INSERT; no inline `--` comments, no embedded `;` — the bootstrap splits on `;` and strips full-line `--`):

```sql
    ('ACCR_INT_RECV', 'Accrued interest receivable', 'asset', FALSE),
    ('ACCR_INT_PAY',  'Accrued interest payable',    'liability', FALSE),
```

(Match the existing column order/tuple shape in that INSERT; the fourth field shown is `open_item_managed = FALSE`.)

- [ ] **Step 2: Extend `scripts/verify-seed.sh` assertions**

Add `ACCR_INT_RECV` and `ACCR_INT_PAY` to the list of codes the script asserts are present after applying schema + seed.

- [ ] **Step 3: Run the verify script**

Run: `export XDG_RUNTIME_DIR=/run/user/1000 XDG_DATA_HOME=/home/bmartins/.local/share; bash scripts/verify-seed.sh`
Expected: PASS — both new codes reported present. (Script runs `psql` inside the `db` container.)

- [ ] **Step 4: Commit**

```bash
git add resources/seed.sql scripts/verify-seed.sh
git commit -m "feat(seed): add accrued-interest GL accounts"
```

---

### Task 3: Legacy core seed — two accrued-interest G/L accounts

**Repo:** `nano-bank-legacy-core` (separate repo). Start: `git checkout -b finance-nim-engine origin/main`.

**Files:**
- Modify: `src/main/resources/data.sql` (the first `ska1` INSERT and the first `skb1` INSERT)
- Modify: `scripts/verify-seed.sh`

**Interfaces:**
- Produces: chart-level `ska1` + company-level `skb1` rows for `saknr` `0000141900` and `0000220000`.

- [ ] **Step 1: Add the two chart-level `ska1` rows**

In the first `INSERT INTO ska1 (ktopl, saknr, xbilk, ktoks, txt50) VALUES ...`, add:

```sql
    ('INT1', '0000141900', 'T', 'RECV', 'Accrued interest receivable'),
    ('INT1', '0000220000', 'T', 'PAYB', 'Accrued interest payable'),
```

- [ ] **Step 2: Add the two company-level `skb1` rows**

In the first `INSERT INTO skb1 (bukrs, saknr, waers, xopvw) VALUES ...`, add:

```sql
    ('1000', '0000141900', 'CAD', FALSE),
    ('1000', '0000220000', 'CAD', FALSE),
```

- [ ] **Step 3: Extend `scripts/verify-seed.sh`**

Add both `saknr` values to the presence assertions for `ska1` (ktopl `INT1`) and `skb1` (bukrs `1000`).

- [ ] **Step 4: Run the verify script**

Run: `export XDG_RUNTIME_DIR=/run/user/1000 XDG_DATA_HOME=/home/bmartins/.local/share; bash scripts/verify-seed.sh`
Expected: PASS — both saknr present at chart and company level.

- [ ] **Step 5: Commit**

```bash
git add src/main/resources/data.sql scripts/verify-seed.sh
git commit -m "feat(data): add accrued-interest G/L accounts"
```

---

### Task 4: Economics tag columns on `transactions`

**Files:**
- Modify: `src/core/tables/04_transactions.sql` (add the three columns to the canonical DDL)
- Modify: `api/src/config/database.rs` (add self-heal `ALTER`s to the `run_migrations` DDL array, ~L144 alongside the existing `ALTER TABLE mandates ADD COLUMN IF NOT EXISTS ...`)

**Interfaces:**
- Produces: `transactions.product TEXT`, `transactions.cost_centre TEXT`, `transactions.economic_event_id UUID` (all nullable).

- [ ] **Step 1: Add columns to the canonical DDL**

In `src/core/tables/04_transactions.sql`, inside the `CREATE TABLE transactions (...)` column list, add:

```sql
    product           TEXT,   -- deposit|card|overdraft|loan|treasury|payment
    cost_centre       TEXT,   -- lending|deposits|payments|treasury
    economic_event_id UUID,   -- stable id shared by all postings of one economic event
```

- [ ] **Step 2: Add idempotent self-heal migrations**

In `api/src/config/database.rs`, in the DDL array iterated by `run_migrations`, add (next to the existing `ALTER TABLE mandates ...`):

```rust
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS product TEXT",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cost_centre TEXT",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS economic_event_id UUID",
        "CREATE INDEX IF NOT EXISTS idx_transactions_event ON transactions(economic_event_id)",
```

- [ ] **Step 3: Verify it compiles and migrations run**

Run: `cargo check -p nano-bank-api`
Expected: PASS (no type errors). The migration runs at boot; verified live in Task 7's integration test.

- [ ] **Step 4: Commit**

```bash
git add src/core/tables/04_transactions.sql api/src/config/database.rs
git commit -m "feat(schema): add economics tag columns to transactions"
```

---

### Task 5: Local accrual subledger + run-ledger schema

**Files:**
- Create: `src/core/tables/13_interest_accruals.sql`
- Modify: `api/src/config/database.rs` (self-heal the new tables in `run_migrations`)

**Interfaces:**
- Produces tables: `interest_accruals`, `accrual_runs`, `capitalisation_runs` (names and columns below are consumed by Tasks 7 & 8).

- [ ] **Step 1: Write the schema file**

Create `src/core/tables/13_interest_accruals.sql`:

```sql
-- Nano Bank Core Database Schema
-- Part 13: Interest accrual subledger + batch run ledgers (spec #2)

-- Per-account, per-day accrued interest. Aggregate GL is posted per day; this
-- keeps the per-account detail so monthly capitalisation and reports reconcile.
CREATE TABLE IF NOT EXISTS interest_accruals (
    accrual_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    accrual_date      DATE NOT NULL,
    product           TEXT NOT NULL,            -- deposit|card|overdraft
    cost_centre       TEXT NOT NULL,            -- deposits|lending
    principal         DECIMAL(15,2) NOT NULL,   -- end-of-day balance the accrual is on
    rate              DECIMAL(5,4) NOT NULL,    -- annual rate used
    amount            DECIMAL(15,2) NOT NULL,   -- rounded daily interest
    side              TEXT NOT NULL,            -- 'expense' (deposit) | 'income' (asset)
    economic_event_id UUID NOT NULL,            -- = the accrual run's event id
    capitalised       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_accrual_amount_precision CHECK (amount = ROUND(amount, 2))
);
-- One accrual per account per day (idempotency at row grain).
CREATE UNIQUE INDEX IF NOT EXISTS uq_interest_accruals_acct_date
    ON interest_accruals(account_id, accrual_date);
CREATE INDEX IF NOT EXISTS idx_interest_accruals_uncap
    ON interest_accruals(account_id) WHERE capitalised = FALSE;

-- One row per completed daily accrual batch. Presence of a 'completed' row for a
-- date makes re-running that date a no-op.
CREATE TABLE IF NOT EXISTS accrual_runs (
    accrual_date      DATE PRIMARY KEY,
    economic_event_id UUID NOT NULL,
    expense_total     DECIMAL(15,2) NOT NULL,
    income_total      DECIMAL(15,2) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'completed',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per completed monthly capitalisation batch (period = 'YYYY-MM').
CREATE TABLE IF NOT EXISTS capitalisation_runs (
    period            TEXT PRIMARY KEY,
    economic_event_id UUID NOT NULL,
    deposit_total     DECIMAL(15,2) NOT NULL,
    asset_total       DECIMAL(15,2) NOT NULL,
    maintenance_total DECIMAL(15,2) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'completed',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Self-heal the tables in `run_migrations`**

In `api/src/config/database.rs`, append the three `CREATE TABLE IF NOT EXISTS ...` statements (and the two indexes) from Step 1 to the `run_migrations` DDL array, so existing DBs gain the tables at boot. Copy them verbatim.

- [ ] **Step 3: Verify compile + boot applies schema**

Run: `cargo check -p nano-bank-api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/tables/13_interest_accruals.sql api/src/config/database.rs
git commit -m "feat(schema): interest accrual subledger and run ledgers"
```

---

### Task 6: Finance module — config + day-count math (pure, unit-tested)

**Files:**
- Create: `api/src/finance/mod.rs`
- Modify: `api/src/main.rs` or `api/src/lib.rs` (add `pub mod finance;` where the other top-level modules are declared)
- Modify: `api/src/config/settings.rs` (add the four tunable rates to `Settings`)

**Interfaces:**
- Produces: `finance::daily_interest(principal: Decimal, annual_rate: Decimal) -> Decimal`; `finance::FinanceConfig { interchange_bps: Decimal, etransfer_fee: Decimal, maintenance_fee: Decimal, maintenance_waiver: Decimal }`; `finance::interchange_amount(purchase: Decimal, bps: Decimal) -> Decimal`; `finance::maintenance_due(balance: Decimal, cfg: &FinanceConfig) -> Decimal`.

- [ ] **Step 1: Write the failing unit tests**

Create `api/src/finance/mod.rs`:

```rust
//! Interest / NIM engine (spec #2): pure money math + config. The batch and
//! inline posting logic lives in `crate::handlers::finance` and reuses these.
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// ACT/365 simple daily interest on an end-of-day balance, rounded to the cent.
pub fn daily_interest(principal: Decimal, annual_rate: Decimal) -> Decimal {
    if principal <= Decimal::ZERO || annual_rate <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    (principal * annual_rate / dec!(365)).round_dp(2)
}

/// Interchange income on a captured purchase at a bps rate, rounded to the cent.
pub fn interchange_amount(purchase: Decimal, bps: Decimal) -> Decimal {
    if purchase <= Decimal::ZERO || bps <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    (purchase * bps / dec!(10000)).round_dp(2)
}

#[derive(Debug, Clone)]
pub struct FinanceConfig {
    pub interchange_bps: Decimal,
    pub etransfer_fee: Decimal,
    pub maintenance_fee: Decimal,
    pub maintenance_waiver: Decimal,
}

/// Monthly maintenance fee due for a deposit account: the flat fee, or zero when
/// the balance is at/above the waiver threshold.
pub fn maintenance_due(balance: Decimal, cfg: &FinanceConfig) -> Decimal {
    if balance >= cfg.maintenance_waiver {
        Decimal::ZERO
    } else {
        cfg.maintenance_fee
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_interest_act_365_rounds_to_cent() {
        // $10,000 at 3% for one day = 0.82 (0.821917… rounded).
        assert_eq!(daily_interest(dec!(10000), dec!(0.0300)), dec!(0.82));
    }

    #[test]
    fn daily_interest_zero_when_no_principal_or_rate() {
        assert_eq!(daily_interest(dec!(0), dec!(0.03)), dec!(0));
        assert_eq!(daily_interest(dec!(1000), dec!(0)), dec!(0));
    }

    #[test]
    fn interchange_150bps() {
        // $100 at 150 bps = $1.50.
        assert_eq!(interchange_amount(dec!(100), dec!(150)), dec!(1.50));
    }

    #[test]
    fn maintenance_waived_at_threshold() {
        let cfg = FinanceConfig {
            interchange_bps: dec!(150),
            etransfer_fee: dec!(1.50),
            maintenance_fee: dec!(4.00),
            maintenance_waiver: dec!(3000),
        };
        assert_eq!(maintenance_due(dec!(2999.99), &cfg), dec!(4.00));
        assert_eq!(maintenance_due(dec!(3000), &cfg), dec!(0));
    }
}
```

- [ ] **Step 2: Declare the module**

Add `pub mod finance;` alongside the other top-level `mod` declarations (same file that declares `mod ledger;` / `mod handlers;`).

- [ ] **Step 3: Run the tests to verify they fail then pass**

Run: `cargo test -p nano-bank-api --bins finance::`
Expected: PASS — 4 tests. (If `rust_decimal_macros` is not yet a dependency, add it to `api/Cargo.toml`; it is already used elsewhere — confirm with `grep rust_decimal_macros api/Cargo.toml`.)

- [ ] **Step 4: Add the tunable rates to `Settings`**

In `api/src/config/settings.rs`, add four fields to `Settings` with the defaults from Global Constraints (env-overridable, following the existing env-var pattern in that file): `interchange_bps` (150), `etransfer_fee` (1.50), `maintenance_fee` (4.00), `maintenance_waiver` (3000). Add a `Settings::finance_config(&self) -> finance::FinanceConfig` helper that builds a `FinanceConfig` from them.

- [ ] **Step 5: Verify compile**

Run: `cargo test -p nano-bank-api --bins finance::`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/finance/mod.rs api/src/config/settings.rs api/src/main.rs
git commit -m "feat(finance): day-count/interchange/fee math and config"
```

---

### Task 7: Daily accrual endpoint (`POST /api/v1/finance/accrue`)

**Files:**
- Create: `api/src/handlers/finance.rs`
- Modify: `api/src/handlers/mod.rs` (add `pub mod finance;`)
- Modify: `api/src/main.rs` (mount `.nest("/api/v1/finance", handlers::finance::finance_routes())`)
- Test: `api/tests/finance.rs` (new integration test file)

**Interfaces:**
- Consumes: `crate::finance::daily_interest`, `Settings::finance_config`, `crate::handlers::cards::post_gl_entry`, `crate::ledger::Account`, `crate::middleware::auth::AuthenticatedService`.
- Produces: `finance_routes() -> Router<AppState>`; `POST /accrue` with body `{ "as_of": "YYYY-MM-DD" }` → `200 { "accrual_date", "expense_total", "income_total", "economic_event_id" }`.

- [ ] **Step 1: Write the failing integration test**

Create `api/tests/finance.rs`. Follow the harness of `api/tests/agents.rs` (spin the app against the test DB, seed a customer + a deposit account with balance and `interest_rate`). Assert:

```rust
// After POST /api/v1/finance/accrue {"as_of":"2026-07-19"} with a $10,000 deposit
// account at 3%:
//   - response.expense_total == 0.82
//   - a second POST for the same date returns the same totals and does NOT
//     create a second accrual row (idempotent).
//   - GET /api/v1/ledger/balances shows InterestExpense debited 0.82 and
//     AccruedInterestPayable credited 0.82.
```

Write the concrete requests/assertions in the style of the existing agent tests (reqwest against the bound port; SQL count on `interest_accruals`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p nano-bank-api --test finance`
Expected: FAIL — route `/api/v1/finance/accrue` returns 404.

- [ ] **Step 3: Implement the accrual handler**

Create `api/src/handlers/finance.rs`:

```rust
//! Interest / NIM engine batch endpoints (spec #2). System-authenticated; driven
//! by cron. `/accrue` computes one day's interest across all eligible accounts and
//! posts the aggregate GL effect; per-account detail lands in `interest_accruals`.
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

    // Deposit side: liability balances earn interest (an expense to the bank).
    // account_type is a deposit type and balance > 0 and interest_rate > 0.
    let deposits = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(
        "SELECT account_id, balance, interest_rate FROM accounts \
         WHERE status = 'active' AND balance > 0 AND interest_rate > 0 \
           AND account_type IN ('chequing','savings')",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut expense_total = Decimal::ZERO;
    let mut tx = state.pool.begin().await?;
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

    // Asset side: card receivable balances the customer owes accrue income.
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

    // Aggregate GL, one balanced entry per side (only when non-zero).
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
```

Note: confirm the exact deposit `account_type` enum values with `grep -n "account_type" src/core/tables/01_enums.sql`; adjust the `IN (...)` / `= 'credit_card'` literals to the real enum labels.

- [ ] **Step 4: Wire the module and route**

Add `pub mod finance;` to `api/src/handlers/mod.rs`, and in `api/src/main.rs` add `.nest("/api/v1/finance", handlers::finance::finance_routes())` beside the other `.nest(...)` calls.

- [ ] **Step 5: Run the integration test**

Run: `cargo test -p nano-bank-api --test finance`
Expected: PASS — accrual totals correct, second run idempotent, GL balances show the accrual.

- [ ] **Step 6: Commit**

```bash
git add api/src/handlers/finance.rs api/src/handlers/mod.rs api/src/main.rs api/tests/finance.rs
git commit -m "feat(finance): daily interest accrual endpoint"
```

---

### Task 8: Monthly capitalisation endpoint (`POST /api/v1/finance/capitalise`)

**Files:**
- Modify: `api/src/handlers/finance.rs` (add `capitalise` + route)
- Test: `api/tests/finance.rs` (add capitalisation test)

**Interfaces:**
- Consumes: `crate::handlers::cards::post_gl_entry`, `crate::handlers::cards::post_two_legged` (customer-level double entry), `crate::finance::maintenance_due`, `Settings::finance_config`.
- Produces: `POST /capitalise` body `{ "period": "YYYY-MM" }` → `200 { "period", "deposit_total", "asset_total", "maintenance_total", "economic_event_id" }`.

- [ ] **Step 1: Write the failing test**

In `api/tests/finance.rs`, add a test asserting:

```rust
// Given two accrued (uncapitalised) daily rows for a deposit account totalling
// $1.64 in period 2026-07, POST /api/v1/finance/capitalise {"period":"2026-07"}:
//   - deposit account balance rises by 1.64
//   - the two interest_accruals rows are now capitalised = true
//   - AccruedInterestPayable is debited 1.64 (holding account drawn down)
//   - a maintenance fee of 4.00 is charged (balance < 3000) to FeeIncome
//   - re-running the same period is a no-op (idempotent).
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p nano-bank-api --test finance`
Expected: FAIL — `/capitalise` 404.

- [ ] **Step 3: Implement `capitalise`**

Add to `api/src/handlers/finance.rs` (register `.route("/capitalise", post(capitalise))` in `finance_routes`). Logic:

```rust
// Idempotency: completed capitalisation_runs row for `period` → return it.
// Else, in one tx:
//   1. Sum uncapitalised interest_accruals per account for the period
//      (accrual_date within the month), split by side.
//   2. Deposit side, per account: credit the customer deposit account by the
//      summed expense-side interest via post_two_legged
//      (Dr AccruedInterestPayable-role customer? no: customer-level credit to the
//       deposit account, contra is the accrued liability). Post the aggregate GL
//      reclass Dr AccruedInterestPayable / Cr CustomerDeposits for the total.
//   3. Asset side, per account: raise the card balance owed; aggregate GL
//      Dr CardReceivable / Cr AccruedInterestReceivable for the total.
//   4. Maintenance fee: for each eligible deposit account, fee = maintenance_due(
//      balance, &cfg); if > 0, debit the customer deposit account and post
//      aggregate GL Dr CustomerDeposits / Cr FeeIncome. Skip if it would breach
//      the overdraft limit (log + defer).
//   5. Mark the summed accrual rows capitalised = true; tag every transactions
//      row created here with product/cost_centre and the run's economic_event_id.
//   6. Insert the capitalisation_runs row; commit; return totals.
```

Write the concrete SQL/`post_two_legged`/`post_gl_entry` calls following Task 7's style. Customer-level balance moves use `post_two_legged(&mut tx, txn_id, deposit_account_id, "credit", <contra account_id>, "debit", amount)` exactly as the card capture does; the GL reclass uses `post_gl_entry` with the roles above.

- [ ] **Step 4: Run the test**

Run: `cargo test -p nano-bank-api --test finance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/handlers/finance.rs api/tests/finance.rs
git commit -m "feat(finance): monthly capitalisation + maintenance fee"
```

---

### Task 9: Interchange income inline at card capture

**Files:**
- Modify: `api/src/handlers/cards.rs` (in `capture`, after the existing `post_gl_entry` for the purchase)
- Test: `api/tests/cards.rs` (or the existing card test file — add an interchange assertion)

**Interfaces:**
- Consumes: `crate::finance::interchange_amount`, `Settings::finance_config`, existing `post_gl_entry`.

- [ ] **Step 1: Write the failing test**

In the card capture test, assert that after a $100 capture, `GET /api/v1/ledger/balances` shows `InterchangeIncome` credited `1.50` and `CashReserves` debited `1.50`, and the `card_purchase` transaction row has `product = 'card'`, `cost_centre = 'payments'`, and a non-null `economic_event_id`.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p nano-bank-api --test cards`
Expected: FAIL — no interchange posting / tags null.

- [ ] **Step 3: Implement**

In `capture`, after the purchase `post_gl_entry(... Receivable, Payable, amount)` succeeds, compute and post interchange, and tag the transaction:

```rust
let cfg = state.settings.finance_config();
let interchange = crate::finance::interchange_amount(amount, cfg.interchange_bps);
let event_id = Uuid::new_v4();
if interchange > Decimal::ZERO {
    post_gl_entry(&state, &reference, "Card interchange income",
        GlAccount::CashReserves, GlAccount::InterchangeIncome, interchange).await?;
}
sqlx::query(
    "UPDATE transactions SET product='card', cost_centre='payments', economic_event_id=$2 \
     WHERE transaction_id=$1",
)
.bind(txn_id).bind(event_id)
.execute(&state.pool).await?;
```

Place the tag `UPDATE` on the same `&mut tx` before commit if the transaction is still open at that point; otherwise use `&state.pool` after commit (match the surrounding code — the existing `jsonb_set` metadata update shows which connection is in scope there).

- [ ] **Step 4: Run the test**

Run: `cargo test -p nano-bank-api --test cards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/handlers/cards.rs api/tests/cards.rs
git commit -m "feat(cards): recognize interchange income at capture"
```

---

### Task 10: e-Transfer fee inline

**Files:**
- Modify: `api/src/handlers/interac.rs` (in `send_etransfer`, after the transfer posts)
- Test: `api/tests/interac.rs` (add fee assertion)

**Interfaces:**
- Consumes: `Settings::finance_config` (`etransfer_fee`), `post_two_legged`, `post_gl_entry`.

- [ ] **Step 1: Write the failing test**

Assert that sending an outgoing e-transfer debits the sender's account an extra `1.50`, credits `FeeIncome` in the GL, and the fee transaction row carries `product='payment'`, `cost_centre='payments'`.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p nano-bank-api --test interac`
Expected: FAIL — no fee charged.

- [ ] **Step 3: Implement**

In `send_etransfer`, after the e-transfer's own postings succeed, charge the fee as a separate tagged transaction: a customer-level `post_two_legged` debiting the sender's deposit account (contra to the fee-income clearing/system account), and an aggregate GL `post_gl_entry(&state, &fee_ref, "e-Transfer fee", GlAccount::CustomerDeposits, GlAccount::FeeIncome, cfg.etransfer_fee)`. Guard with the overdraft-limit check (defer + log if it would breach). Tag the fee transaction `product='payment', cost_centre='payments'` with a shared `economic_event_id`.

- [ ] **Step 4: Run the test**

Run: `cargo test -p nano-bank-api --test interac`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/handlers/interac.rs api/tests/interac.rs
git commit -m "feat(interac): charge and recognize e-transfer fee income"
```

---

### Task 11: Cross-backend verification script + cron docs

**Files:**
- Create: `testing/verify-nim-engine.sh`
- Modify: `api/CLAUDE.md` or a short `docs/` note (document the two endpoints + a sample daily crontab, mirroring the nav-snapshot cron pattern)

**Interfaces:**
- Consumes: the running app on `:8081` against a started core.

- [ ] **Step 1: Write the verification script**

Create `testing/verify-nim-engine.sh` (run once per `CORE_BACKEND`): seed a deposit account with a balance and rate; `POST /api/v1/finance/accrue` for a date; assert `expense_total` and that `GET /api/v1/ledger/balances` shows the accrual on `interest_expense`/`accrued_interest_payable`; `POST /api/v1/finance/capitalise` for the period; assert the holding account drew down and the deposit balance rose; do a $100 card capture and assert `interchange_income` moved; send an e-transfer and assert `fee_income` moved. `set -euo pipefail`; use `curl -fsS`.

- [ ] **Step 2: Run against modern core**

Run: `export XDG_RUNTIME_DIR=/run/user/1000 XDG_DATA_HOME=/home/bmartins/.local/share; CORE_BACKEND=modern bash testing/verify-nim-engine.sh`
Expected: PASS. (Identify the app listener PID via `ss -ltnp | grep ':8081'`; kill by PID when done.)

- [ ] **Step 3: Run against legacy core**

Run: `CORE_BACKEND=legacy bash testing/verify-nim-engine.sh`
Expected: PASS.

- [ ] **Step 4: Document endpoints + cron**

Add a short section documenting `POST /finance/accrue` (daily) and `POST /finance/capitalise` (monthly) and a sample crontab entry that calls `/accrue` daily.

- [ ] **Step 5: Commit**

```bash
git add testing/verify-nim-engine.sh api/CLAUDE.md
git commit -m "test(finance): cross-backend NIM engine verification + cron docs"
```

---

## Self-Review

**Spec coverage:** §1 new accounts → Tasks 1–3; §2 endpoints/layout → Tasks 6–8; §3 accrual/capitalisation → Tasks 7–8; §4 interchange/fees → Tasks 9, 10, 8 (maintenance); §5 tag columns → Task 4 (consumed in 7–10); §6 idempotency/error handling → run-ledgers in Tasks 5/7/8 + overdraft-floor guard in 8/10; §7 testing → per-task tests + Task 11 both-backend. All sections covered.

**Placeholder scan:** No "TBD/TODO"; each code step shows real code. Two deliberate implementation-time confirmations are flagged, not left vague: the exact `account_type` enum labels (Task 7 Step 3) and whether the tag `UPDATE` runs on the open `tx` or the pool (Task 9 Step 3) — both point at the concrete file/line to check.

**Type consistency:** `daily_interest`, `interchange_amount`, `maintenance_due`, `FinanceConfig` (Task 6) are used with the same signatures in Tasks 7–10. `post_gl_entry(&state, ref, desc, debit, credit, amount)` and `post_two_legged(&mut tx, txn_id, a, dir, b, dir, amount)` match their real definitions in `cards.rs`. `Account::AccruedInterestReceivable/Payable` (Task 1) are the roles posted in Tasks 7–8. Run-ledger/subledger table + column names in Task 5 match their reads/writes in Tasks 7–8.
