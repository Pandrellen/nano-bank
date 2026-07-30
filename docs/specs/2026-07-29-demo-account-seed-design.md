# Demo account: 6-month salary history + personal-manager access

Date: 2026-07-29
Status: Approved (design)

## Problem

We want a one-command demo, on top of the now-deployable full stack, that lets
someone (a) log into the UI as a realistic customer and (b) talk to the
personal-manager agent about that customer's finances. Today there is no fixed
login and no transaction history: `agent/seed.py` creates random-per-run
customers with no history, and every transaction the API writes is stamped
`CURRENT_TIMESTAMP`, so "6 months of salary" needs a post-hoc backdate.

## Goals

- A seeded customer with **fixed, documented credentials** usable for UI login.
- A **realistic personal profile** and **6 months of monthly transactions**: a
  salary credit plus recurring debits (rent, groceries, utilities) each month.
- The **personal-manager agent can act as this customer** (appears in the console
  picker; the agent resolves its token).
- Idempotent and re-runnable; opt-in (not auto-run by `deploy-all.sh`).

## Non-goals

- No changes to bank-API or ledger behaviour.
- No new address/employment API (the profile uses only the fields
  `POST /api/v1/customers` accepts; "personal history" = profile + 6-month
  financial history).
- Not wired into `deploy-all.sh` (run manually after it).

## Fixed credentials & profile

- Email `demo@nano.bank`, password `Demo-Pass-2026` (≥ 8 chars).
- Profile: first `Jordan`, last `Demo`, DOB `1990-05-14`, SIN `046454286`
  (9 digits, passes the API's `length == 9` + `^[0-9]{9}$` check), phone a
  unique 10+ digit value.

## Architecture

```
scripts/demo-seed.sh
  ├─ kubectl port-forward svc/bank-api 8081   (bank-api is ClusterIP-only)
  ├─ python testing/demo/seed_demo_account.py --api http://localhost:8081
  │     ├─ create/login demo customer (idempotent)  → API
  │     ├─ open chequing account                     → API
  │     ├─ 6× {salary deposit + rent/groceries/utilities withdrawals} → API
  │     │     (captures each transaction_id + its target date)
  │     └─ backdate those txns via kubectl exec deploy/postgres -- psql
  └─ prints creds + UI URL + agent-console steps
```

### Component 1 — `testing/demo/seed_demo_account.py`

Pure-ish Python using `requests`. Structure so logic is unit-testable:

- `monthly_schedule(now) -> list[Cycle]` — **pure**. For each of the last 6
  whole months, produce dated line items: salary `+4200.00` on the 26th, rent
  `-1600.00` on the 1st, groceries `-550.00` on the 15th, utilities `-180.00`
  on the 18th. Returns `[(date, kind, amount)]`. Deterministic given `now`.
- `BankApi` thin client: `create_customer`, `login`, `create_account`,
  `deposit`, `withdrawal` (each returns parsed JSON incl. `transaction_id`).
- `seed(api, psql_exec, now)` — orchestration:
  1. Idempotent customer: `login()`; on failure `create_customer()` then `login()`.
  2. Reuse existing chequing account if the customer has one, else `create_account`.
  3. For each scheduled item, call deposit/withdrawal; collect
     `(transaction_id, target_datetime)`.
  4. Backdate: build one SQL batch and run it through `psql_exec(sql)` —
     `UPDATE transactions SET created_at=$ts, processed_at=$ts, completed_at=$ts
     WHERE transaction_id=$id` and `UPDATE transaction_entries SET created_at=$ts
     WHERE transaction_id=$id`, per collected txn. (All three timestamps set
     together to satisfy `chk_status_timestamps`.)
  5. Return a summary (customer_id, account_id, counts, ending balance).
- `psql_exec` default runs
  `kubectl exec -n nano-bank deploy/postgres -- psql -U nanobank_user -d nano_bank_db -v ON_ERROR_STOP=1 -f -`
  with the SQL on stdin. Injected for tests.

### Component 2 — `scripts/demo-seed.sh`

`set -euo pipefail`. Port-forward `svc/bank-api 8081` (background, trap-killed on
exit), wait until `curl :8081/health` is 200, run the seeder with the repo's
Node-independent Python, then print creds + `http://localhost:3000` + the agent
steps. Fails clearly if the stack isn't up.

### Component 3 — agent adopt-hook (`agent/seed.py`)

Extend `seed_demo(bank)` to also adopt the fixed demo customer, **API-only**:

```
try:
    token = bank.login("demo@nano.bank", "Demo-Pass-2026")
except Exception:
    pass  # demo not seeded yet — skip
else:
    cid = bank.profile(token)["customer_id"]  # GET /api/v1/customers/profile
    store.put(cid, "demo@nano.bank", "Demo-Pass-2026")
    customers.append({"customer_id": cid, "email": "demo@nano.bank",
                      "first": "Jordan", "account_id": <first chequing account_id>})
```

`GET /api/v1/customers/profile` returns `customer_id` (verified in
`api/src/handlers/customers.rs::get_profile`), so the id resolves from a login +
read. No customer creation, no DB write — consistent with the agent's "writes via
API, reads via DB" rule. A `profile()` helper is added to the agent's bank client
if it lacks one. The demo customer then appears in the console picker and the
agent can act as it.

## Testing

- **pytest (agent):** `monthly_schedule` is deterministic (6 cycles, correct
  dates/amounts/signs); `seed()` against a fake `BankApi` + fake `psql_exec`
  records the expected API calls and emits backdating SQL for every txn (create
  path and idempotent-existing path). Agent adopt-hook: with a fake bank that
  logs in successfully, `seed_demo` includes the demo customer and registers its
  creds; with a failing login, it skips silently.
- **Live verification (stack up):** run `./scripts/demo-seed.sh`; then via the
  API confirm `GET /api/v1/transactions` shows 6 salary credits dated across the
  last 6 months plus the recurring debits; confirm UI login at `localhost:3000`;
  spot-check the agent console surfaces the customer.

## Delivery

Commit to branch `ui-fullstack-and-tests`; push updates **PR #40**. Add a short
demo walkthrough to `ui/README.md` (or `docs/`) and have the script self-document
on success.

## Risks / trade-offs

- **Direct SQL backdating** is confined to the demo tool (like `testing/cleanup.sh`);
  it does not touch the agent or bank-API code paths.
- **`chk_status_timestamps`**: all of created/processed/completed set to the same
  backdated instant to stay valid. `daily_transaction_summaries` is left at its
  original date (the agent reads the `transactions` table, not summaries).
- Backdating targets only rows this run created (by captured `transaction_id`),
  so re-runs never rewrite unrelated history.
