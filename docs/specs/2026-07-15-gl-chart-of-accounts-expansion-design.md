# GL Chart-of-Accounts Expansion — Design (Spec #1)

**Date:** 2026-07-15
**Status:** Approved (brainstorming); ready for implementation planning
**Scope:** First of a five-spec **bank profitability & capital** programme (see
"Programme context" below). This spec covers **only** growing the general-ledger
chart of accounts so richer income/expense/asset/equity lines *exist and are
postable* through both cores. No accruals, recognition, reporting, or economics
are built here.

---

## Programme context

The user wants nano-bank to (1) produce monthly/yearly financial reports,
(2) calculate profitability and costs, (3) attribute cost & profit to each
transaction, and (4) calculate Economic Capital → RAROC — at **full Basel-style
rigor** as the north star.

These four asks form a **dependency stack**, delivered as five sequential,
independently-verifiable specs:

1. **GL chart-of-accounts expansion** ← *this spec*. The accounting backbone.
2. **Interest / NIM engine** — daily interest accrual (deposits → expense;
   card/overdraft balances → income; surplus deposits placed at a policy rate →
   treasury income), plus interchange & fee recognition, posting to the new GL
   accounts; monthly capitalisation. **This is where the economics *tag columns*
   land** (see "Forward requirements").
3. **`nano-bank-finance` service** — a new Python (FastAPI + Streamlit) read-side
   service that classifies the GL into IFRS statement lines, runs **period-close
   snapshots**, and produces Balance Sheet / Income Statement / NIM reports.
4. **Per-transaction profitability** — an attribution layer (revenue, cost of
   funds / FTP, unit cost, expected loss) keyed to each transaction/position.
5. **Economic Capital + RAROC** — Basel IRB credit capital (PD/LGD/EAD, maturity,
   correlation @ 99.9%) + operational-risk capital, and RAROC per exposure.

### Decisions locked during brainstorming

- **Revenue model:** full **spread** bank — net interest income (interest earned
  on card/overdraft/loan/treasury assets − interest paid on deposits) + interchange
  + fees. The earning assets that generate interest income (`credit_card` balances,
  overdrawn chequing) **already exist** in the data model; no new loan product is
  built here (loans are owned by separate work — the account is defined now, unused).
- **P&L origination:** interest is **posted as real journal entries in the core
  GL** (not merely derived at report time).
- **GL granularity:** **expand the authoritative core chart of accounts** (this
  spec) rather than overlay detail only in nano-bank's local subledger.
- **Reporting placement:** a **separate Python finance service** (spec #3).
- **Period model:** **period-close snapshots** (spec #3).
- **Economics (cost/profit/EC) home:** an **analytical attribution layer** keyed
  to transactions/positions (specs #4–#5), *reconciled to* the GL — **not** posted
  as journal entries. Rationale: the GL records real value movements; cost of
  funds is an internal transfer price, expected loss is a provision (postable),
  but **economic capital is a risk measure, never a journal entry**.

---

## Background: how the GL works today

nano-bank posts accounting entries through a small backend-agnostic **`Ledger`
port** (`api/src/ledger/mod.rs`) to one of two interchangeable core services,
chosen at startup by `CORE_BACKEND=modern|legacy`. The port speaks **semantic
account roles**, and each adapter maps a role to that backend's real account id:

- Port `Account` enum today: `Bank`, `Receivable`, `Payable`, `Revenue`,
  `Expense` (5 roles), each with `modern_code()` and `legacy_account()`.
- **Modern core** (`nano-bank-modern-core`): a `gl_account(code, name, kind,
  currency, open_item_managed)` table seeded idempotently in `resources/seed.sql`.
  `kind` is free-text (`asset|liability|revenue|expense`); nothing computes a
  balance sign from it, so it is pure classification metadata.
- **Legacy core** (`nano-bank-legacy-core`): a chart-level GL master `ska1(ktopl,
  saknr, xbilk, ktoks, txt50)` and a company-level master `skb1(bukrs, saknr,
  waers, xopvw)`, seeded in `src/main/resources/data.sql`. `xbilk` = balance-sheet
  flag, `ktoks` = account group (free string, not FK-constrained), `xopvw` =
  open-item management. An account-determination table `t030` maps transaction
  keys → account numbers but is **not** used by the Ledger adapter (the adapter
  maps roles straight to `saknr`), so it is optional here.

nano-bank keeps a **granular per-customer subledger locally** and posts only the
**aggregate** GL effect to a core (the cards/rails dual-post pattern). Both cores
were verified to keep balance math independent of `kind`/`xbilk`, so adding an
`equity` classification is safe.

---

## This spec: expand the chart of accounts

**Additive and non-breaking.** The existing 5 roles stay exactly as they are, so
every current handler (cards, rails, deposits/withdrawals, the manual
`/ledger/journal` demo) keeps working untouched. We add **13 new roles** beside
them.

### Target chart of accounts

| Port `Account` role | IFRS line | modern `code` / `kind` | legacy `saknr` / `xbilk` / `ktoks` |
|---|---|---|---|
| `CashReserves`        | Asset     | `CASH_RESERVES` / asset     | `0000105000` / TRUE  / `CASH` |
| `CardReceivable`      | Asset     | `CARD_AR` / asset           | `0000141000` / TRUE  / `RECV` |
| `OverdraftReceivable` | Asset     | `OVERDRAFT_AR` / asset      | `0000141500` / TRUE  / `RECV` |
| `LoansReceivable`     | Asset     | `LOANS_AR` / asset          | `0000142000` / TRUE  / `RECV` |
| `TreasuryPlacement`   | Asset     | `TREASURY` / asset          | `0000150000` / TRUE  / `CASH` |
| `CustomerDeposits`    | Liability | `DEPOSITS` / liability      | `0000210000` / TRUE  / `PAYB` |
| `Capital`             | Equity    | `CAPITAL` / **equity**      | `0000300000` / TRUE  / `EQTY` |
| `RetainedEarnings`    | Equity    | `RETAINED` / **equity**     | `0000330000` / TRUE  / `EQTY` |
| `InterestIncome`      | Income    | `INT_INCOME` / revenue      | `0000800100` / FALSE / `REVN` |
| `InterchangeIncome`   | Income    | `INTERCHANGE` / revenue     | `0000800200` / FALSE / `REVN` |
| `FeeIncome`           | Income    | `FEE_INCOME` / revenue      | `0000800300` / FALSE / `REVN` |
| `InterestExpense`     | Expense   | `INT_EXPENSE` / expense     | `0000400100` / FALSE / `EXPN` |
| `OperatingExpense`    | Expense   | `OPEX` / expense            | `0000400200` / FALSE / `EXPN` |

Notes:
- Numbering follows the existing scheme: `1xxxxx` assets, `2xxxxx` liabilities,
  `3xxxxx` equity (new range), `4xxxxx` expense (P&L), `8xxxxx` revenue (P&L).
- `LoansReceivable` is **defined but unused** here — a separate workstream owns the
  loan product. Defining it now reserves the number and lets the later credit-risk
  EC model map cleanly onto distinct exposure classes (card vs overdraft vs loan
  carry different PD/LGD).
- All new accounts are **not open-item managed** (`open_item_managed`/`xopvw` =
  FALSE): they are aggregate positions; per-item detail lives in nano-bank's local
  subledger, not the core's open-item clearing.
- `ktoks = 'EQTY'` is a new account group; `ktoks` is free-text with no group
  master FK, so no additional master row is required. (Implementation should
  confirm no other legacy master enforces the group.)

### Change set

**1. `nano-bank` — Ledger port (`api/src/ledger/mod.rs`)**
- Add the 13 variants to `enum Account`.
- Add their arms to `modern_code()` and `legacy_account()` per the table.
- No handler changes; the existing 5 roles are untouched.

**2. `nano-bank-modern-core`**
- Add 13 idempotent rows to `resources/seed.sql`'s `gl_account` INSERT, including
  two rows with `kind = 'equity'` (a new classification value; the column is
  free-text so no schema change is required).

**3. `nano-bank-legacy-core`**
- Add 13 rows to the `ska1` INSERT (chart level) and 13 to the `skb1` INSERT
  (company level) in `src/main/resources/data.sql`, using the `saknr`/`xbilk`/
  `ktoks`/`xopvw` values from the table above.
- Account-determination (`t030`) rows are **optional** (the adapter maps roles to
  `saknr` directly) and are out of scope for this spec.

All three change sets are idempotent (existing `ON CONFLICT DO NOTHING`
patterns / additive enum variants).

---

## Forward requirements (baked in now, built later)

The per-transaction economics (specs #4–#5) attach an attribution layer to each
economically-meaningful event. To make that clean, the *tagging* requirement is
recorded now and **implemented in spec #2** (the first spec that creates such
postings), not here:

- Every economic event (interest accrual, fee/interchange recognition, and
  balance-bearing position) must carry a **stable id** and tags for **product**
  (deposit / card / overdraft / loan / treasury / payment-rail), **counterparty**
  (customer/account), and a **cost-centre / desk** (lending / deposits / payments
  / treasury).
- The `transactions` table already has `transaction_id` + a `metadata` JSONB hook;
  spec #2 will formalise the tag columns/keys there.

This spec introduces **no** tag columns — it only ensures the destination
accounts exist.

---

## Testing / done criteria

Done when, for **both** backends:

1. A balanced journal entry that debits/credits any **new** account posts
   successfully via `POST /api/v1/ledger/journal` (nano-bank) → the core.
2. `GET /api/v1/ledger/balances` reports the new accounts with correct balances.
3. Round-trip verified against `CORE_BACKEND=modern` **and** `CORE_BACKEND=legacy`
   (the same request lands in each core).

Concretely: a small integration check that posts e.g.
`Dr CashReserves / Cr CustomerDeposits` and `Dr InterestExpense / Cr
CustomerDeposits`, then reads balances, run once per backend. Existing modern-core
unit tests and the nano-bank build (`cargo check`/`clippy`) must stay green;
legacy core must start with the expanded `data.sql` and accept a post to a new
`saknr`.

---

## Out of scope (later specs)

- Interest accrual, interchange/fee recognition, monthly capitalisation (spec #2).
- Statement classification, period close, Balance Sheet / Income Statement / NIM
  reports, the `nano-bank-finance` Python service (spec #3).
- Per-transaction cost/profit attribution and FTP (spec #4).
- Economic Capital and RAROC (spec #5).
- Any economics tag columns (spec #2).
- `t030` account-determination entries for the new accounts.

## Open questions

None blocking. One implementation-time check: confirm the legacy core has no
additional master-data constraint on the `ktoks` account group `EQTY` (none seen
in the seed); add a group master row if it does.
