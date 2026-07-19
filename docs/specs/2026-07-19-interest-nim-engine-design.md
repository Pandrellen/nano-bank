# Interest / NIM Engine — Design (Spec #2)

Status: approved (brainstorming), not yet implemented.

## Programme context

This is spec #2 of the five-spec financial-reporting stack:

1. **Spec #1 — GL chart-of-accounts expansion** (built; PR #29 open). Added the
   13 bank-economics account roles, including the income/expense accounts this
   spec posts to (`InterestIncome`, `InterestExpense`, `InterchangeIncome`,
   `FeeIncome`).
2. **Spec #2 — this doc.** The interest / NIM engine: turn balances × rates into
   real GL postings over time, recognize interchange and fee income, and
   formalise the economics **tag columns** that spec #1 deferred.
3. Spec #3 — `nano-bank-finance` Python service: monthly/yearly reports,
   period-close snapshots, Balance Sheet / Income Statement / NIM.
4. Spec #4 — per-transaction cost/profit attribution and FTP.
5. Spec #5 — Economic Capital and RAROC.

Spec #2 produces the income and expense postings that spec #3's reports read.

## Decisions locked during brainstorming

- **Scope:** full net-interest-margin engine — deposit interest expense **and**
  card/overdraft interest income — **plus** interchange income and fee income.
- **Trigger model:** interest is a **daily accrual batch**; interchange and the
  e-transfer fee are recognized **inline** at the originating event; the monthly
  maintenance fee rides the month-end capitalisation batch.
- **Accrual holding:** **true accrual** — daily accrual posts into two new
  holding accounts and monthly **capitalisation** reclasses them into the
  customer-facing positions. (Not a post-monthly subledger; not accrue-straight-
  into-balance.)
- **Fees:** a per-outgoing-e-transfer fee (inline) and a monthly account-
  maintenance fee (batch, waived above a balance threshold).
- **Tags:** real, nullable columns on nano-bank's `transactions` table (not
  JSONB), added by an additive self-heal migration.

## Background: what already exists

- `accounts` already carries per-account `interest_rate DECIMAL(5,4)` (deposit
  return / card APR), `overdraft_limit`, and `minimum_balance`. Chequing is
  seeded at 3%; cards carry an APR. **The raw rates already exist** — this spec
  only turns them into postings over time.
- nano-bank keeps its own customer-level double-entry ledger (`transactions` +
  `transaction_entries`, with balance triggers) in its Postgres, and separately
  posts **aggregate GL** to the modern/legacy core through the `Ledger` port —
  the same two-ledger pattern the card and rail flows already use.
- Card flow is authorize → capture → settle. **No interchange is modelled
  today.** **No fees are charged anywhere today** (e-transfer is a plain
  payee-tagged withdrawal). Interchange and fees are therefore net-new postings.

## 1. New GL accounts (spec #2 owns these)

Two accrued-interest holding accounts, added to the `Ledger` port
(`api/src/ledger/mod.rs`) and both core seeds, using spec #1's additive,
compiler-enforced pattern (new enum variants + `modern_code()`/`legacy_account()`
arms; idempotent seed rows).

| Port role | IFRS line | modern `code` / `kind` | legacy `saknr` / `xbilk` / `ktoks` |
|---|---|---|---|
| `AccruedInterestReceivable` | Asset     | `ACCR_INT_RECV` / asset     | `0000141900` / TRUE / `RECV` |
| `AccruedInterestPayable`    | Liability | `ACCR_INT_PAY` / liability  | `0000220000` / TRUE / `PAYB` |

- Both **not** open-item managed (`open_item_managed` / `xopvw` = FALSE): aggregate
  positions; per-account detail lives in the local accrual subledger.
- Numbering follows spec #1's scheme: `141900` sits beside `CardReceivable`
  (`141000`) in the asset range; `220000` in the liability range beside
  `CustomerDeposits` (`210000`).
- This does **not** modify spec #1 / PR #29 — spec #2 extends the chart itself.

## 2. Execution model & code layout

New `finance` area in nano-bank:

- `api/src/handlers/finance.rs` — the two batch endpoints.
- `api/src/finance/` — accrual, capitalisation, interchange, and fee logic
  (kept out of the handlers so it is unit-testable in isolation).
- `src/core/tables/13_interest_accruals.sql` — the local subledger and run
  ledgers (next-numbered schema file, per house convention).
- Tag-column migration on `transactions` (self-heal `ALTER`, §5).

Endpoints (system/admin-authenticated, not customer-facing):

- **`POST /api/v1/finance/accrue`** — body `{ "as_of": "YYYY-MM-DD" }`. Computes
  one day's interest across all eligible accounts, both sides. **Idempotent per
  date**: a completed run for `as_of` is a verified no-op (never double-accrues).
  Cron-driven; a sample crontab is documented alongside the nav-snapshot cron
  pattern.
- **`POST /api/v1/finance/capitalise`** — body `{ "period": "YYYY-MM" }`. Reclasses
  the period's uncapitalised accruals into customer-facing balances and charges
  the monthly maintenance fee. **Idempotent per period.**

Inline recognition (no new endpoint):

- **Interchange** — inside the existing card `capture` handler.
- **e-Transfer fee** — inside the e-transfer / withdrawal post path.

## 3. Accrual & capitalisation mechanics

**Convention:** ACT/365, simple daily interest on end-of-day balance. All money
is `Decimal`; per-account per-day amounts are rounded to the cent, and each day's
GL posting is the **sum of the rounded per-account amounts**, so the GL total
always equals the subledger (no rounding drift).

**Deposit side (daily), per deposit account with `balance > 0` and
`interest_rate > 0`:**

```
daily = round(balance * interest_rate / 365, 2)
```

GL (aggregate for the day): `Dr InterestExpense / Cr AccruedInterestPayable` for
Σ daily. Per-account rows written to `interest_accruals`.

**Card / overdraft side (daily), per account owing (card receivable / negative
deposit within overdraft):**

```
daily = round(owed * apr / 365, 2)
```

GL (aggregate for the day): `Dr AccruedInterestReceivable / Cr InterestIncome`.

**Capitalisation (monthly), per account, summing that account's uncapitalised
accruals for the period:**

- Deposit: `Dr AccruedInterestPayable / Cr <customer deposit account>` — the
  customer's balance rises via a normal `interest`-typed transaction (customer-
  level double entry + the GL reclass).
- Card / overdraft: `Dr <customer owed position> / Cr AccruedInterestReceivable`
  — the customer's owed balance rises by the accrued interest. The owed position
  is the card balance for a card, or the overdrawn deposit account (driven more
  negative) for an overdraft.
- The capitalised accrual rows are marked `capitalised = true`.

After a clean monthly capitalisation the two holding accounts return to zero for
fully-capitalised balances (residual only from same-month accruals not yet due).

## 4. Interchange & fees

Defaults below are tunable via config (env), not hard-coded business policy.

- **Interchange** (inline at capture): `round(amount * INTERCHANGE_BPS/10000, 2)`,
  default **150 bps**. Posting `Dr CashReserves / Cr InterchangeIncome`. GL-only:
  the customer already paid at capture; interchange is bank-vs-network income, so
  no customer-account movement. Tagged `product = card`, `cost_centre = payments`.
- **e-Transfer fee** (inline): flat **$1.50** per outgoing e-transfer. Posting
  `Dr <customer deposit account> / Cr FeeIncome`. Tagged `product = payment`,
  `cost_centre = payments`.
- **Monthly maintenance fee** (in the capitalise batch): **$4 / account / month**,
  **waived when the account balance ≥ $3000**. Posting
  `Dr <customer deposit account> / Cr FeeIncome`. Tagged `product = deposit`,
  `cost_centre = deposits`.

## 5. Economics tag columns (fulfils spec #1's deferred requirement)

Add three nullable columns to nano-bank's `transactions` via an additive
self-heal `ALTER` (same idempotent-on-boot pattern as the interac migration;
existing rows stay NULL):

- `product VARCHAR` — `deposit｜card｜overdraft｜loan｜treasury｜payment`
- `cost_centre VARCHAR` — `lending｜deposits｜payments｜treasury`
- `economic_event_id UUID` — a stable id shared by all postings of one accrual
  run / capitalisation / fee event.

Counterparty is already captured by `initiated_by` and the entry's `account_id`,
so no counterparty column is added. Every posting this spec creates is tagged;
specs #3 and #4 group by these keys. This spec **consumes** the tags for
correctness (they must be present and consistent) but does **not** build any
report on them.

## 6. Idempotency & error handling

- **Batch idempotency:** each batch is keyed by date/period in a run ledger. A
  re-run of a completed date/period is a no-op; an incomplete run can be safely
  retried. Accrual and capitalisation never double-post.
- **Atomicity:** each posting-set is one DB transaction; partial failure rolls
  back and the run is not marked complete, so a retry reprocesses cleanly.
- **Eligibility:** accrual skips closed accounts, zero balances, and zero rates.
- **Fee floor:** a fee never forces an account below its overdraft limit — if it
  would, the fee is deferred and logged rather than forced (no involuntary
  overdraft created by a fee).
- **Shared event id:** all GL + customer-level postings of one logical event
  carry the same `economic_event_id`, so the two ledgers reconcile per event.

## 7. Testing / done criteria

Done when, for **both** `CORE_BACKEND=modern` and `CORE_BACKEND=legacy`:

1. **Accrual** — `POST /finance/accrue` for a date posts the aggregate
   `Dr InterestExpense / Cr AccruedInterestPayable` and
   `Dr AccruedInterestReceivable / Cr InterestIncome`, matching the sum of the
   per-account subledger rows.
2. **Capitalisation** — `POST /finance/capitalise` for the period reclasses the
   holding accounts into customer balances (deposit balances rise; card balances
   owed rise), the holding accounts zero out, and accrual rows are marked
   capitalised.
3. **Interchange** — a card `capture` books `Dr CashReserves / Cr InterchangeIncome`
   at the configured bps, tagged.
4. **Fees** — an outgoing e-transfer books the $1.50 fee inline; the maintenance
   fee is charged in the capitalise batch and correctly waived above the
   threshold.
5. **Idempotency** — re-running any accrue date or capitalise period changes
   nothing.
6. **Tags** — every new posting carries `product`, `cost_centre`, and a shared
   `economic_event_id`.

Unit tests cover the day-count rounding (Σ rounded per-account = GL total), the
waiver threshold, and the interchange math. Existing tests, `cargo check`, and
`cargo clippy` stay green; both cores boot with the two new accounts.

## 8. Out of scope (later specs)

- Reports, period-close snapshots, Balance Sheet / Income Statement / NIM
  statements, the `nano-bank-finance` Python service (spec #3).
- Per-transaction cost/profit attribution and FTP (spec #4).
- Economic Capital and RAROC (spec #5).
- Loan-product interest: `LoansReceivable` stays defined-but-unused (separate
  loan workstream).
- A configurable fee catalogue: this spec hard-wires two fee types with
  config-tunable rates; a general fee-type table is deferred.
- `t030` account-determination entries for the two new accounts (the adapter maps
  roles to `saknr` directly, as in spec #1).

## Open questions

None blocking. One implementation-time check: confirm the modern core accepts
`kind = 'liability'`/`'asset'` for the two new accounts (it does for spec #1's
rows) and that the legacy `ktoks = 'PAYB'`/`'RECV'` groups already exist from
spec #1 (they do), so no new group masters are required.
