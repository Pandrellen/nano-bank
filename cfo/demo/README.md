# CFO demo

Two scripts: one brings the stack up, the other fills the bank with events so
the Agent CFO has a real balance sheet to talk about.

```bash
bash cfo/demo/run-cfo-stack.sh     # start everything, prints the console URL
bash cfo/demo/seed-demo-bank.sh    # generate the event stack + close the period
# → chat at http://localhost:8506
bash cfo/demo/run-cfo-stack.sh --stop
```

## What comes up

| Process | Port | Notes |
|---|---|---|
| bank API | 8081 | run **from source** (`api/target/debug/nano-bank-api`) |
| modern core | 8191 | already running in the `modern-core` Kind cluster |
| finance MCP | 8088 | reads the core trial balance, owns the report math |
| CFO API | 8089 | `POST /ask`, `GET /health` |
| CFO console | 8506 | Streamlit chat |

Postgres must be reachable on `::1:5432` (the Kind port-forward) and
`agent/.env` must hold `OLLAMA_API_KEY`.

The bank API runs from source deliberately: the `bank-api` image deployed in the
`nano-bank` cluster predates the finance specs, so it has neither the expanded GL
chart nor `/api/v1/finance/*`. Redeploying that image would make the in-cluster
service work too.

## What gets seeded

1. **Treasury desk** — capital injection, wholesale deposit funding, treasury
   placements, a consumer loan book, card + overdraft receivables.
2. **Retail customers** — 5 customers with chequing/savings/credit-card accounts,
   deposits, withdrawals, transfers.
3. **Card rails** — authorize → capture → settle (recognizes interchange income).
4. **Interac e-Transfer** — one send (recognizes fee income).
5. **Bank P&L** — treasury/loan/card interest earned, deposit funding cost, opex.
6. **Finance batches** — 10 days of daily interest accrual, then month
   capitalisation (deposit + card interest, maintenance fees).
7. **Period close** — snapshots the trial balance into `gl_snapshots`.

Steps 1 and 5 post through `POST /api/v1/ledger/journal` because no handler
originates treasury placements or a loan book yet — those GL roles arrived with
spec #1 and are driven by later specs. Everything else is real bank traffic
through the real handlers.

Tunable: `CUSTOMERS`, `ACCRUAL_DAYS`, `PERIOD`, `API`.

## Things to ask

- "Give me the financial health of the bank for 2026-07."
- "Where is our profit actually coming from? Which revenue lines are sustainable?"
- "What is our RAROC and is it above a sensible hurdle rate?"
- "Break down the P&L by segment — which product line earns its keep?"
- "How exposed are we if our cost of funds rises 200 bps?"

The CFO is read-only: it will analyse and recommend, but it cannot move money or
post entries.
