# GL Chart-of-Accounts Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 new semantic GL account roles (assets, a liability, equity, income and expense lines) to nano-bank's `Ledger` port and to both core backends' seed data, so richer bank-economics postings *exist and are postable* — without changing any existing behaviour.

**Architecture:** nano-bank posts through a backend-agnostic `Ledger` port (`api/src/ledger/mod.rs`) whose `Account` enum names semantic roles; two adapters map each role to a backend's real account id (modern GL `code`, legacy `saknr`). This plan (1) extends that enum + its two mapping functions, then (2) seeds the matching accounts in the modern core (`resources/seed.sql`) and (3) the legacy core (`src/main/resources/data.sql`). It is **additive and non-breaking**: the existing 5 roles (`Bank`, `Receivable`, `Payable`, `Revenue`, `Expense`) are untouched.

**Tech Stack:** Rust (`axum 0.7`, `serde`, `rust_decimal`) for nano-bank + the modern core; PostgreSQL 16 seed SQL for both cores; Java/Spring for the legacy core (data-only change, no Java touched). Three separate git repos: `nano-bank`, `nano-bank-modern-core`, `nano-bank-legacy-core`.

## Global Constraints

- **Additive only.** Do not modify or reorder the existing 5 `Account` variants or their existing mappings (`Bank→BANK/0000113100`, `Receivable→AR/0000140000`, `Payable→AP/0000160000`, `Revenue→REVENUE/0000800000`, `Expense→EXPENSE/0000400000`). Every existing handler must keep compiling and posting unchanged.
- **Exact account map** (source of truth — copy verbatim):

  | Port `Account` role | modern `code` / `kind` | legacy `saknr` / `xbilk` / `ktoks` / `xopvw` |
  |---|---|---|
  | `CashReserves`        | `CASH_RESERVES` / `asset`     | `0000105000` / TRUE  / `CASH` / FALSE |
  | `CardReceivable`      | `CARD_AR` / `asset`           | `0000141000` / TRUE  / `RECV` / FALSE |
  | `OverdraftReceivable` | `OVERDRAFT_AR` / `asset`      | `0000141500` / TRUE  / `RECV` / FALSE |
  | `LoansReceivable`     | `LOANS_AR` / `asset`          | `0000142000` / TRUE  / `RECV` / FALSE |
  | `TreasuryPlacement`   | `TREASURY` / `asset`          | `0000150000` / TRUE  / `CASH` / FALSE |
  | `CustomerDeposits`    | `DEPOSITS` / `liability`      | `0000210000` / TRUE  / `PAYB` / FALSE |
  | `Capital`             | `CAPITAL` / `equity`          | `0000300000` / TRUE  / `EQTY` / FALSE |
  | `RetainedEarnings`    | `RETAINED` / `equity`         | `0000330000` / TRUE  / `EQTY` / FALSE |
  | `InterestIncome`      | `INT_INCOME` / `revenue`      | `0000800100` / FALSE / `REVN` / FALSE |
  | `InterchangeIncome`   | `INTERCHANGE` / `revenue`     | `0000800200` / FALSE / `REVN` / FALSE |
  | `FeeIncome`           | `FEE_INCOME` / `revenue`      | `0000800300` / FALSE / `REVN` / FALSE |
  | `InterestExpense`     | `INT_EXPENSE` / `expense`     | `0000400100` / FALSE / `EXPN` / FALSE |
  | `OperatingExpense`    | `OPEX` / `expense`            | `0000400200` / FALSE / `EXPN` / FALSE |

- **JSON identifiers** are the serde snake_case of each variant: `cash_reserves`, `card_receivable`, `overdraft_receivable`, `loans_receivable`, `treasury_placement`, `customer_deposits`, `capital`, `retained_earnings`, `interest_income`, `interchange_income`, `fee_income`, `interest_expense`, `operating_expense`.
- **Legacy naming rule (repo policy):** the cryptic legacy identifiers (`ska1`, `skb1`, `saknr`, `xbilk`, `ktoks`, `xopvw`, `ktopl`, `bukrs`) are neutral technical names — do **not** add code/comments describing what product they resemble. New `txt50` descriptions must be plain accounting English (e.g. `'Customer deposits'`), no product references.
- **Legacy seed keys:** chart of accounts key `ktopl='INT1'`; company code `bukrs='1000'`; currency `'CAD'`. Use these for every new row.
- **Modern seed SQL is split naively** (`nano-bank-modern-core/src/db.rs::bootstrap` strips full-line `--` comments and splits on `;`): new rows must live **inside** the existing single `gl_account` INSERT (one statement, no inline comments, no embedded semicolons).
- **`LoansReceivable` is defined but unused** here — a separate workstream owns the loan product. Seed the account; do not add any posting logic for it.
- **No new tag columns, no interest logic, no reporting** — those are later specs. This plan only makes the accounts exist and be postable.
- **nano-bank DB host is `::1`** (IPv6 loopback), not `127.0.0.1`, for the integration task.

---

### Task 1: Extend the Ledger port with 13 new account roles

**Repo:** `nano-bank`

**Files:**
- Modify: `api/src/ledger/mod.rs` (the `Account` enum ~lines 19-25, `modern_code()` ~29-37, `legacy_account()` ~40-48)
- Test: same file, a new `#[cfg(test)]` module at the end

**Interfaces:**
- Consumes: nothing (leaf change).
- Produces: 13 new `Account` variants usable by handlers and by the `/api/v1/ledger/journal` deserializer, each with a `modern_code()` and `legacy_account()` mapping per the Global Constraints table. The `#[serde(rename_all = "snake_case")]` on the enum makes each variant deserialize from the JSON identifier listed above.

Note: `modern_code()` and `legacy_account()` are exhaustive `match self { .. }` with no wildcard arm, so the compiler **forces** a mapping arm for every new variant — a missed arm is a build error, not a silent bug. The unit test below pins the exact strings.

- [ ] **Step 1: Write the failing test**

Append to `api/src/ledger/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::Account;

    /// Every new role maps to the agreed modern code and legacy saknr.
    /// Existing roles are asserted too, to catch accidental edits.
    #[test]
    fn account_mappings_are_stable() {
        let cases = [
            // (role, modern_code, legacy_account)
            (Account::Bank, "BANK", "0000113100"),
            (Account::Receivable, "AR", "0000140000"),
            (Account::Payable, "AP", "0000160000"),
            (Account::Revenue, "REVENUE", "0000800000"),
            (Account::Expense, "EXPENSE", "0000400000"),
            (Account::CashReserves, "CASH_RESERVES", "0000105000"),
            (Account::CardReceivable, "CARD_AR", "0000141000"),
            (Account::OverdraftReceivable, "OVERDRAFT_AR", "0000141500"),
            (Account::LoansReceivable, "LOANS_AR", "0000142000"),
            (Account::TreasuryPlacement, "TREASURY", "0000150000"),
            (Account::CustomerDeposits, "DEPOSITS", "0000210000"),
            (Account::Capital, "CAPITAL", "0000300000"),
            (Account::RetainedEarnings, "RETAINED", "0000330000"),
            (Account::InterestIncome, "INT_INCOME", "0000800100"),
            (Account::InterchangeIncome, "INTERCHANGE", "0000800200"),
            (Account::FeeIncome, "FEE_INCOME", "0000800300"),
            (Account::InterestExpense, "INT_EXPENSE", "0000400100"),
            (Account::OperatingExpense, "OPEX", "0000400200"),
        ];
        for (role, modern, legacy) in cases {
            assert_eq!(role.modern_code(), modern, "modern_code for {role:?}");
            assert_eq!(role.legacy_account(), legacy, "legacy_account for {role:?}");
        }
    }

    /// The JSON wire name for each new role is its snake_case identifier,
    /// which is what `/ledger/journal` accepts.
    #[test]
    fn new_roles_deserialize_from_snake_case() {
        let json = r#"["cash_reserves","customer_deposits","interest_income","interest_expense","retained_earnings"]"#;
        let roles: Vec<Account> = serde_json::from_str(json).expect("valid roles");
        assert_eq!(
            roles,
            vec![
                Account::CashReserves,
                Account::CustomerDeposits,
                Account::InterestIncome,
                Account::InterestExpense,
                Account::RetainedEarnings,
            ]
        );
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bmartins/dev/nano-bank/api && cargo test -p nano-bank-api account_mappings_are_stable`
Expected: **compile error** — `no variant named CashReserves` (and the other 12). The enum doesn't have them yet.

- [ ] **Step 3: Add the 13 variants to the enum**

In `api/src/ledger/mod.rs`, replace the enum body:

```rust
pub enum Account {
    Bank,
    Receivable,
    Payable,
    Revenue,
    Expense,
}
```

with:

```rust
pub enum Account {
    Bank,
    Receivable,
    Payable,
    Revenue,
    Expense,
    // Bank-economics chart (spec: GL chart-of-accounts expansion). Additive only.
    CashReserves,
    CardReceivable,
    OverdraftReceivable,
    LoansReceivable,
    TreasuryPlacement,
    CustomerDeposits,
    Capital,
    RetainedEarnings,
    InterestIncome,
    InterchangeIncome,
    FeeIncome,
    InterestExpense,
    OperatingExpense,
}
```

- [ ] **Step 4: Add the modern-code arms**

In `modern_code()`, replace:

```rust
            Account::Expense => "EXPENSE",
        }
    }
```

with:

```rust
            Account::Expense => "EXPENSE",
            Account::CashReserves => "CASH_RESERVES",
            Account::CardReceivable => "CARD_AR",
            Account::OverdraftReceivable => "OVERDRAFT_AR",
            Account::LoansReceivable => "LOANS_AR",
            Account::TreasuryPlacement => "TREASURY",
            Account::CustomerDeposits => "DEPOSITS",
            Account::Capital => "CAPITAL",
            Account::RetainedEarnings => "RETAINED",
            Account::InterestIncome => "INT_INCOME",
            Account::InterchangeIncome => "INTERCHANGE",
            Account::FeeIncome => "FEE_INCOME",
            Account::InterestExpense => "INT_EXPENSE",
            Account::OperatingExpense => "OPEX",
        }
    }
```

- [ ] **Step 5: Add the legacy-account arms**

In `legacy_account()`, replace:

```rust
            Account::Expense => "0000400000",
        }
    }
```

with:

```rust
            Account::Expense => "0000400000",
            Account::CashReserves => "0000105000",
            Account::CardReceivable => "0000141000",
            Account::OverdraftReceivable => "0000141500",
            Account::LoansReceivable => "0000142000",
            Account::TreasuryPlacement => "0000150000",
            Account::CustomerDeposits => "0000210000",
            Account::Capital => "0000300000",
            Account::RetainedEarnings => "0000330000",
            Account::InterestIncome => "0000800100",
            Account::InterchangeIncome => "0000800200",
            Account::FeeIncome => "0000800300",
            Account::InterestExpense => "0000400100",
            Account::OperatingExpense => "0000400200",
        }
    }
```

- [ ] **Step 6: Run tests + lint to verify green**

Run: `cd /home/bmartins/dev/nano-bank/api && cargo test -p nano-bank-api account_mappings_are_stable new_roles_deserialize_from_snake_case && cargo clippy -p nano-bank-api --all-targets`
Expected: both tests **PASS**; clippy reports **no new warnings** (pre-existing dead-code warnings on stub handlers are unrelated — see `api/CLAUDE.md`).

- [ ] **Step 7: Commit**

```bash
cd /home/bmartins/dev/nano-bank
git add api/src/ledger/mod.rs
git commit -m "feat(ledger): add 13 bank-economics account roles to the Ledger port

Additive: 13 new Account variants (asset/liability/equity/income/expense)
with their modern_code() and legacy_account() mappings. Existing 5 roles
untouched. Unit tests pin the mappings and the snake_case wire names."
```

---

### Task 2: Seed the 13 accounts in the modern core

**Repo:** `nano-bank-modern-core`

**Files:**
- Modify: `resources/seed.sql` (the `gl_account` INSERT, lines 1-9)

**Interfaces:**
- Consumes: the modern `code` / `kind` column of the Global Constraints table.
- Produces: 13 rows in `gl_account` whose `code` matches `Account::modern_code()` from Task 1, so a journal line naming any new role resolves to a seeded account. Two rows carry the **new** `kind = 'equity'` value (the column is free-text, no schema change).

- [ ] **Step 1: Write the failing verification test**

Create `scripts/verify-seed.sh` in `nano-bank-modern-core`:

```bash
#!/usr/bin/env bash
# Verifies the expanded chart of accounts seeded into a fresh modern-core DB.
set -euo pipefail
PGURL="postgres://core:core@localhost:5435/modern_core"

docker compose up -d db
# wait for Postgres to accept connections
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U core -d modern_core >/dev/null 2>&1; then break; fi
  sleep 1
done

# Apply schema + seed the same way the service does (idempotent).
psql "$PGURL" -v ON_ERROR_STOP=1 -f resources/schema.sql -f resources/seed.sql

NEW_CODES="CASH_RESERVES CARD_AR OVERDRAFT_AR LOANS_AR TREASURY DEPOSITS CAPITAL RETAINED INT_INCOME INTERCHANGE FEE_INCOME INT_EXPENSE OPEX"
missing=0
for code in $NEW_CODES; do
  found=$(psql "$PGURL" -tAc "SELECT count(*) FROM gl_account WHERE code = '$code'")
  if [ "$found" != "1" ]; then echo "MISSING: $code (count=$found)"; missing=1; fi
done

equity=$(psql "$PGURL" -tAc "SELECT count(*) FROM gl_account WHERE kind = 'equity'")
if [ "$equity" != "2" ]; then echo "EXPECTED 2 equity accounts, got $equity"; missing=1; fi

if [ "$missing" != "0" ]; then echo "SEED VERIFY: FAIL"; exit 1; fi
echo "SEED VERIFY: PASS (13 new codes present, 2 equity)"
```

Make it executable: `chmod +x scripts/verify-seed.sh` (create `scripts/` if absent).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/bmartins/dev/nano-bank-modern-core && ./scripts/verify-seed.sh`
Expected: **FAIL** — prints `MISSING: CASH_RESERVES` … and `SEED VERIFY: FAIL` (seed doesn't have the new rows yet). If the compose DB retains an old volume, that's fine — the check is on `code`, and the new codes are absent.

- [ ] **Step 3: Add the 13 seed rows**

In `resources/seed.sql`, replace the `gl_account` INSERT:

```sql
INSERT INTO gl_account (code, name, kind, currency, open_item_managed) VALUES
    ('BANK',       'Bank account',         'asset',     'CAD', FALSE),
    ('AR',         'Accounts receivable',  'asset',     'CAD', TRUE),
    ('AP',         'Accounts payable',     'liability', 'CAD', TRUE),
    ('REVENUE',    'Revenue',              'revenue',   'CAD', FALSE),
    ('EXPENSE',    'Operating expenses',   'expense',   'CAD', FALSE),
    ('INPUT_TAX',  'Input tax',            'asset',     'CAD', FALSE),
    ('OUTPUT_TAX', 'Output tax',           'liability', 'CAD', FALSE)
ON CONFLICT (code) DO NOTHING;
```

with (existing rows unchanged; 13 appended before the `ON CONFLICT` line):

```sql
INSERT INTO gl_account (code, name, kind, currency, open_item_managed) VALUES
    ('BANK',          'Bank account',            'asset',     'CAD', FALSE),
    ('AR',            'Accounts receivable',     'asset',     'CAD', TRUE),
    ('AP',            'Accounts payable',        'liability', 'CAD', TRUE),
    ('REVENUE',       'Revenue',                 'revenue',   'CAD', FALSE),
    ('EXPENSE',       'Operating expenses',      'expense',   'CAD', FALSE),
    ('INPUT_TAX',     'Input tax',               'asset',     'CAD', FALSE),
    ('OUTPUT_TAX',    'Output tax',              'liability', 'CAD', FALSE),
    ('CASH_RESERVES', 'Cash reserves',           'asset',     'CAD', FALSE),
    ('CARD_AR',       'Card receivable',         'asset',     'CAD', FALSE),
    ('OVERDRAFT_AR',  'Overdraft receivable',    'asset',     'CAD', FALSE),
    ('LOANS_AR',      'Loans receivable',        'asset',     'CAD', FALSE),
    ('TREASURY',      'Treasury placements',     'asset',     'CAD', FALSE),
    ('DEPOSITS',      'Customer deposits',       'liability', 'CAD', FALSE),
    ('CAPITAL',       'Share capital',           'equity',    'CAD', FALSE),
    ('RETAINED',      'Retained earnings',       'equity',    'CAD', FALSE),
    ('INT_INCOME',    'Interest income',         'revenue',   'CAD', FALSE),
    ('INTERCHANGE',   'Interchange income',      'revenue',   'CAD', FALSE),
    ('FEE_INCOME',    'Fee income',              'revenue',   'CAD', FALSE),
    ('INT_EXPENSE',   'Interest expense',        'expense',   'CAD', FALSE),
    ('OPEX',          'Operating expense',       'expense',   'CAD', FALSE)
ON CONFLICT (code) DO NOTHING;
```

- [ ] **Step 4: Run the verification to confirm it passes**

Run: `cd /home/bmartins/dev/nano-bank-modern-core && ./scripts/verify-seed.sh`
Expected: `SEED VERIFY: PASS (13 new codes present, 2 equity)`.

- [ ] **Step 5: Confirm the service still boots and existing tests pass**

Run: `cd /home/bmartins/dev/nano-bank-modern-core && cargo test`
Expected: existing unit tests **PASS** (the seed change is data-only; `bootstrap()` splits the still-single INSERT statement fine — no new `;` or inline comments were introduced).

- [ ] **Step 6: Commit**

```bash
cd /home/bmartins/dev/nano-bank-modern-core
git add resources/seed.sql scripts/verify-seed.sh
git commit -m "feat(seed): add 13 bank-economics GL accounts

Adds cash-reserves, card/overdraft/loans receivable, treasury, deposits,
capital, retained earnings, interest/interchange/fee income, and
interest/operating expense to the gl_account seed (two with kind=equity).
Idempotent via ON CONFLICT. scripts/verify-seed.sh checks the seed."
```

---

### Task 3: Seed the 13 accounts in the legacy core

**Repo:** `nano-bank-legacy-core`

**Files:**
- Modify: `src/main/resources/data.sql` (the first `ska1` INSERT at lines 16-23 and the first `skb1` INSERT at lines 26-33)

**Interfaces:**
- Consumes: the legacy `saknr` / `xbilk` / `ktoks` / `xopvw` columns of the Global Constraints table.
- Produces: 13 rows in `ska1` (chart level) and 13 in `skb1` (company level) whose `saknr` matches `Account::legacy_account()` from Task 1, so a legacy document posting to any new role resolves to a seeded account. `ktoks='EQTY'` is a new account-group value (free-text, no group-master FK).

- [ ] **Step 1: Write the failing verification test**

Create `scripts/verify-seed.sh` in `nano-bank-legacy-core`:

```bash
#!/usr/bin/env bash
# Verifies the expanded chart of accounts seeded into a fresh legacy-core DB.
set -euo pipefail
PGURL="postgres://core:core@localhost:5434/legacycore"

docker compose up -d db
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U core -d legacycore >/dev/null 2>&1; then break; fi
  sleep 1
done

# Apply schema + data the same way Spring does (idempotent).
psql "$PGURL" -v ON_ERROR_STOP=1 -f src/main/resources/schema.sql -f src/main/resources/data.sql

NEW_SAKNR="0000105000 0000141000 0000141500 0000142000 0000150000 0000210000 0000300000 0000330000 0000800100 0000800200 0000800300 0000400100 0000400200"
missing=0
for saknr in $NEW_SAKNR; do
  chart=$(psql "$PGURL" -tAc "SELECT count(*) FROM ska1 WHERE ktopl='INT1' AND saknr='$saknr'")
  comp=$(psql "$PGURL" -tAc "SELECT count(*) FROM skb1 WHERE bukrs='1000' AND saknr='$saknr'")
  if [ "$chart" != "1" ] || [ "$comp" != "1" ]; then
    echo "MISSING saknr $saknr (ska1=$chart skb1=$comp)"; missing=1
  fi
done

if [ "$missing" != "0" ]; then echo "SEED VERIFY: FAIL"; exit 1; fi
echo "SEED VERIFY: PASS (13 new accounts at chart + company level)"
```

Make it executable: `chmod +x scripts/verify-seed.sh` (create `scripts/` if absent).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/bmartins/dev/nano-bank-legacy-core && ./scripts/verify-seed.sh`
Expected: **FAIL** — prints `MISSING saknr 0000105000 (ska1=0 skb1=0)` … and `SEED VERIFY: FAIL`.

- [ ] **Step 3: Add the 13 chart-level rows (`ska1`)**

In `src/main/resources/data.sql`, replace the first `ska1` INSERT (lines 16-23):

```sql
INSERT INTO ska1 (ktopl, saknr, xbilk, ktoks, txt50) VALUES
    ('INT1', '0000100000', TRUE,  'CASH', 'Cash and cash equivalents'),
    ('INT1', '0000113100', TRUE,  'BANK', 'Bank account - main'),
    ('INT1', '0000140000', TRUE,  'RECV', 'Accounts receivable'),
    ('INT1', '0000160000', TRUE,  'PAYB', 'Accounts payable'),
    ('INT1', '0000800000', FALSE, 'REVN', 'Revenue'),
    ('INT1', '0000400000', FALSE, 'EXPN', 'Operating expenses')
ON CONFLICT (ktopl, saknr) DO NOTHING;
```

with (existing rows unchanged; 13 appended before `ON CONFLICT`):

```sql
INSERT INTO ska1 (ktopl, saknr, xbilk, ktoks, txt50) VALUES
    ('INT1', '0000100000', TRUE,  'CASH', 'Cash and cash equivalents'),
    ('INT1', '0000113100', TRUE,  'BANK', 'Bank account - main'),
    ('INT1', '0000140000', TRUE,  'RECV', 'Accounts receivable'),
    ('INT1', '0000160000', TRUE,  'PAYB', 'Accounts payable'),
    ('INT1', '0000800000', FALSE, 'REVN', 'Revenue'),
    ('INT1', '0000400000', FALSE, 'EXPN', 'Operating expenses'),
    ('INT1', '0000105000', TRUE,  'CASH', 'Cash reserves'),
    ('INT1', '0000141000', TRUE,  'RECV', 'Card receivable'),
    ('INT1', '0000141500', TRUE,  'RECV', 'Overdraft receivable'),
    ('INT1', '0000142000', TRUE,  'RECV', 'Loans receivable'),
    ('INT1', '0000150000', TRUE,  'CASH', 'Treasury placements'),
    ('INT1', '0000210000', TRUE,  'PAYB', 'Customer deposits'),
    ('INT1', '0000300000', TRUE,  'EQTY', 'Share capital'),
    ('INT1', '0000330000', TRUE,  'EQTY', 'Retained earnings'),
    ('INT1', '0000800100', FALSE, 'REVN', 'Interest income'),
    ('INT1', '0000800200', FALSE, 'REVN', 'Interchange income'),
    ('INT1', '0000800300', FALSE, 'REVN', 'Fee income'),
    ('INT1', '0000400100', FALSE, 'EXPN', 'Interest expense'),
    ('INT1', '0000400200', FALSE, 'EXPN', 'Operating expense')
ON CONFLICT (ktopl, saknr) DO NOTHING;
```

- [ ] **Step 4: Add the 13 company-level rows (`skb1`)**

In the same file, replace the first `skb1` INSERT (lines 26-33):

```sql
INSERT INTO skb1 (bukrs, saknr, waers, xopvw) VALUES
    ('1000', '0000100000', 'CAD', FALSE),
    ('1000', '0000113100', 'CAD', FALSE),
    ('1000', '0000140000', 'CAD', TRUE),
    ('1000', '0000160000', 'CAD', TRUE),
    ('1000', '0000800000', 'CAD', FALSE),
    ('1000', '0000400000', 'CAD', FALSE)
ON CONFLICT (bukrs, saknr) DO NOTHING;
```

with (existing rows unchanged; 13 appended before `ON CONFLICT`):

```sql
INSERT INTO skb1 (bukrs, saknr, waers, xopvw) VALUES
    ('1000', '0000100000', 'CAD', FALSE),
    ('1000', '0000113100', 'CAD', FALSE),
    ('1000', '0000140000', 'CAD', TRUE),
    ('1000', '0000160000', 'CAD', TRUE),
    ('1000', '0000800000', 'CAD', FALSE),
    ('1000', '0000400000', 'CAD', FALSE),
    ('1000', '0000105000', 'CAD', FALSE),
    ('1000', '0000141000', 'CAD', FALSE),
    ('1000', '0000141500', 'CAD', FALSE),
    ('1000', '0000142000', 'CAD', FALSE),
    ('1000', '0000150000', 'CAD', FALSE),
    ('1000', '0000210000', 'CAD', FALSE),
    ('1000', '0000300000', 'CAD', FALSE),
    ('1000', '0000330000', 'CAD', FALSE),
    ('1000', '0000800100', 'CAD', FALSE),
    ('1000', '0000800200', 'CAD', FALSE),
    ('1000', '0000800300', 'CAD', FALSE),
    ('1000', '0000400100', 'CAD', FALSE),
    ('1000', '0000400200', 'CAD', FALSE)
ON CONFLICT (bukrs, saknr) DO NOTHING;
```

- [ ] **Step 5: Run the verification to confirm it passes**

Run: `cd /home/bmartins/dev/nano-bank-legacy-core && ./scripts/verify-seed.sh`
Expected: `SEED VERIFY: PASS (13 new accounts at chart + company level)`.

- [ ] **Step 6: Confirm the legacy service boots with the expanded data**

Run: `cd /home/bmartins/dev/nano-bank-legacy-core && ./start-core.sh` then, once up, `curl -fsS localhost:8090/actuator/health || curl -fsS localhost:8090/health`
Expected: the stack starts without a data-load error (Spring applies `data.sql` idempotently at boot) and the health check returns success. Stop it afterward with `./stop-core.sh`.

- [ ] **Step 7: Commit**

```bash
cd /home/bmartins/dev/nano-bank-legacy-core
git add src/main/resources/data.sql scripts/verify-seed.sh
git commit -m "feat(data): add 13 bank-economics G/L accounts

Adds the chart-level (ska1) and company-level (skb1) master rows for the
new asset/liability/equity/income/expense accounts, matching the Ledger
port's legacy_account() numbers. Idempotent. scripts/verify-seed.sh checks
the seed."
```

---

### Task 4: Cross-backend round-trip integration verification

**Repos:** `nano-bank` (+ a running core from Task 2 / Task 3). Verification only; produces a committed check script, no product-code change.

**Files:**
- Create: `testing/verify-gl-expansion.sh` in `nano-bank`

**Interfaces:**
- Consumes: the new roles from Task 1 (as JSON identifiers) and the seeded accounts from Tasks 2-3.
- Produces: a repeatable script proving the spec's done-criteria — a balanced journal touching **new** accounts posts and shows up in balances, against **both** `CORE_BACKEND=modern` and `CORE_BACKEND=legacy`.

This is the spec's done-criteria gate. It requires the Kind Postgres up (nano-bank health-checks at startup; DB host `::1`), plus the target core running.

- [ ] **Step 1: Write the verification script**

Create `testing/verify-gl-expansion.sh`:

```bash
#!/usr/bin/env bash
# Proves a balanced journal touching the NEW GL accounts posts and reads back,
# against whichever core nano-bank is currently pointed at.
# Prereq: Kind Postgres up; nano-bank running on :8081 against a started core.
set -euo pipefail
API="${API:-http://localhost:8081}"

echo "Posting Dr CashReserves / Cr CustomerDeposits (100.00) ..."
curl -fsS -X POST "$API/api/v1/ledger/journal" \
  -H 'content-type: application/json' \
  -d '{"reference":"gl-exp-1","description":"seed deposit",
       "lines":[{"account":"cash_reserves","direction":"debit","amount":100.00},
                {"account":"customer_deposits","direction":"credit","amount":100.00}]}'
echo

echo "Posting Dr InterestExpense / Cr CustomerDeposits (5.00) ..."
curl -fsS -X POST "$API/api/v1/ledger/journal" \
  -H 'content-type: application/json' \
  -d '{"reference":"gl-exp-2","description":"interest accrual demo",
       "lines":[{"account":"interest_expense","direction":"debit","amount":5.00},
                {"account":"customer_deposits","direction":"credit","amount":5.00}]}'
echo

echo "Balances:"
curl -fsS "$API/api/v1/ledger/balances"
echo
echo "VERIFY: check the response above lists the new accounts with non-zero balances."
```

Make executable: `chmod +x testing/verify-gl-expansion.sh`.

- [ ] **Step 2: Run against the modern core**

```bash
# terminal A — Kind Postgres (from nano-bank root, if not already up)
cd /home/bmartins/dev/nano-bank && ./k8s/deploy.sh
kubectl port-forward -n nano-bank svc/postgres-service 5432:5432 &
# terminal B — modern core (from nano-bank-modern-core)
cd /home/bmartins/dev/nano-bank-modern-core && docker compose up -d db
DATABASE_URL=postgres://core:core@localhost:5435/modern_core cargo run &
# terminal C — nano-bank against modern
cd /home/bmartins/dev/nano-bank/api && CORE_BACKEND=modern MODERN_CORE_URL=http://localhost:8091 cargo run &
sleep 5
cd /home/bmartins/dev/nano-bank && ./testing/verify-gl-expansion.sh
```

Expected: both POSTs return a `PostedEntry` JSON (`{"id":...,"backend":"modern"}`); the balances response includes the new accounts (the core reports codes like `CASH_RESERVES`, `DEPOSITS`, `INT_EXPENSE`) with the expected signs. No 400/422 (would mean an unknown/unbalanced account) and no 503 (core unreachable).

- [ ] **Step 3: Run against the legacy core**

Stop the modern-backed nano-bank (by PID — **not** `pkill -f target/debug/nano-bank-api`, which would kill the launching shell), start the legacy core, and restart nano-bank against it:

```bash
cd /home/bmartins/dev/nano-bank-legacy-core && ./start-core.sh
cd /home/bmartins/dev/nano-bank/api && CORE_BACKEND=legacy LEGACY_CORE_URL=http://localhost:8090 cargo run &
sleep 5
cd /home/bmartins/dev/nano-bank && ./testing/verify-gl-expansion.sh
```

Expected: both POSTs return a `PostedEntry` with `"backend":"legacy"` and a legacy document id (`belnr`); the balances response includes the new `saknr`-backed accounts. The same request landing in each core (different id/`belnr`) is the kernel-split proof for the expanded chart.

- [ ] **Step 4: Commit the verification script**

```bash
cd /home/bmartins/dev/nano-bank
git add testing/verify-gl-expansion.sh
git commit -m "test(ledger): cross-backend round-trip check for expanded GL chart

Posts a balanced journal touching the new accounts and reads balances;
run once per CORE_BACKEND (modern|legacy) to prove the spec done-criteria."
```

---

## Self-Review

**Spec coverage:**
- Spec change-set item 1 (Ledger port: 13 variants + `modern_code`/`legacy_account` arms) → Task 1. ✓
- Spec change-set item 2 (modern core: 13 `gl_account` rows incl. 2 `equity`) → Task 2. ✓
- Spec change-set item 3 (legacy core: 13 `ska1` + 13 `skb1` rows) → Task 3. ✓
- Spec done-criteria (balanced journal to a new account posts + shows in balances, verified against modern **and** legacy) → Task 4. ✓
- Spec "additive/non-breaking; existing 5 roles untouched" → Global Constraints + Task 1 asserts existing mappings unchanged. ✓
- Spec "all new accounts not open-item managed (`open_item_managed`/`xopvw`=FALSE)" → encoded in Tasks 2 & 3 rows. ✓
- Spec "`LoansReceivable` defined but unused" → seeded in all three tasks, no posting logic added. ✓
- Spec "no tag columns / no interest / no reporting here" → Global Constraints; none of the tasks add them. ✓
- Spec legacy `ktoks='EQTY'` free-text, no group-master needed → Task 3 note; verify script checks presence, and the open-question (confirm no group-master FK) surfaces at boot in Task 3 Step 6 (a missing FK constraint would fail the data load there). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code and SQL step shows the full content. ✓

**Type consistency:** The 13 variant names, `modern_code()` strings, `legacy_account()` numbers, JSON snake_case identifiers, modern `code`/`kind`, and legacy `saknr`/`xbilk`/`ktoks`/`xopvw` are identical across the Global Constraints table, Task 1 (enum + arms + unit test), Task 2 (seed), Task 3 (seed), and Task 4 (JSON `cash_reserves`/`customer_deposits`/`interest_expense`). ✓
