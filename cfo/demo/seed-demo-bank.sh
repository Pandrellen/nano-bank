#!/usr/bin/env bash
# Seed a demo bank with a full stack of events that trickle down into the
# financial tables, so the Agent CFO has a real balance sheet to talk about.
#
# What it drives (all through the real API / the real Ledger port):
#   1. Treasury desk       — capital, cash reserves, treasury placements, a loan
#                            book, card + overdraft receivables (POST /ledger/journal)
#   2. Retail customers    — customers, chequing/savings/credit-card accounts,
#                            deposits, withdrawals, transfers
#   3. Card rails          — authorize -> capture -> settle (interchange income)
#   4. Interac e-Transfer  — a send (fee income)
#   5. Bank P&L            — treasury/loan interest income, funding cost, opex
#   6. Finance batches     — daily interest accrual + month capitalisation
#                            (deposit interest, card interest, maintenance fees)
#   7. Period close        — snapshots the trial balance into gl_snapshots
#
# Note: steps 1 and 5 post through /api/v1/ledger/journal because no handler
# originates treasury placements or a loan book yet (those GL roles came with
# spec #1 and are driven by later specs). Everything else is real bank traffic.
#
# Prereqs: bank API on :8081 and the finance venv (finance/.venv).
#   API=http://localhost:8081 bash cfo/demo/seed-demo-bank.sh
set -euo pipefail

API="${API:-http://localhost:8081}"
SERVICE_SECRET="${SERVICE_SECRET:-nano-bank-visa-network-secret-change-me}"
PERIOD="${PERIOD:-$(date +%Y-%m)}"
CUSTOMERS="${CUSTOMERS:-5}"
ACCRUAL_DAYS="${ACCRUAL_DAYS:-10}"
PW="demopass123"
TAG="cfodemo$(date +%s)"

cd "$(dirname "$0")/../.."

jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
step() { printf '\n\033[0;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[0;32m✓\033[0m %s\n' "$*"; }

journal() { # <description> <lines-json>
  curl -fsS -XPOST "$API/api/v1/ledger/journal" -H 'content-type: application/json' \
    -d "{\"description\":\"$1\",\"lines\":$2}" >/dev/null
  ok "$1"
}
leg() { printf '{"account":"%s","direction":"%s","amount":%s}' "$1" "$2" "$3"; }

step "0/7  health + service token"
curl -fsS "$API/health" >/dev/null
SVC=$(curl -fsS -XPOST "$API/api/v1/auth/service-token" -H 'content-type: application/json' \
  -d "{\"client_secret\":\"$SERVICE_SECRET\"}" | jget "['access_token']")
ok "bank API reachable at $API"

# ── 1. Treasury desk: build the bank's own balance sheet ─────────────────────
step "1/7  treasury desk — capital, reserves, placements, loan book"
journal "shareholder capital injection" \
  "[$(leg cash_reserves debit 500000.00),$(leg capital credit 500000.00)]"
journal "wholesale deposit funding"     \
  "[$(leg cash_reserves debit 400000.00),$(leg customer_deposits credit 400000.00)]"
journal "treasury placement — govt bills" \
  "[$(leg treasury_placement debit 200000.00),$(leg cash_reserves credit 200000.00)]"
journal "consumer loan book drawdown"   \
  "[$(leg loans_receivable debit 250000.00),$(leg cash_reserves credit 250000.00)]"
journal "card receivable book"          \
  "[$(leg card_receivable debit 60000.00),$(leg cash_reserves credit 60000.00)]"
journal "overdraft book"                \
  "[$(leg overdraft_receivable debit 15000.00),$(leg cash_reserves credit 15000.00)]"

# ── 2. Retail customers ──────────────────────────────────────────────────────
step "2/7  retail customers, accounts and transactions"
declare -a EMAILS=() TOKENS=() CHEQ=() CARDS=()
for i in $(seq 1 "$CUSTOMERS"); do
  N=$((RANDOM * 32768 + RANDOM))
  EMAIL="${TAG}_${i}@example.com"
  curl -fsS -XPOST "$API/api/v1/customers" -H 'content-type: application/json' -d "{
    \"email\":\"$EMAIL\",\"phone_number\":\"$(printf '%010d' $((N % 10000000000)))\",
    \"first_name\":\"Demo\",\"last_name\":\"Customer$i\",\"date_of_birth\":\"1988-04-1$((i % 9))\",
    \"sin\":\"$(printf '%09d' $((N % 1000000000)))\",\"password\":\"$PW\"}" >/dev/null
  TOK=$(curl -fsS -XPOST "$API/api/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | jget "['access_token']")

  mkacct() {
    curl -fsS -XPOST "$API/api/v1/accounts" -H "authorization: Bearer $TOK" \
      -H 'content-type: application/json' -d "{\"account_type\":\"$1\"}" | jget "['account_id']"
  }
  C=$(mkacct chequing); S=$(mkacct savings); K=$(mkacct credit_card)

  tx() { curl -fsS -XPOST "$API/api/v1/transactions/$1" -H "authorization: Bearer $TOK" \
           -H 'content-type: application/json' -d "$2" >/dev/null; }
  tx deposit  "{\"account_id\":\"$C\",\"amount\":$((3000 + i * 700)).00,\"description\":\"payroll\"}"
  tx deposit  "{\"account_id\":\"$S\",\"amount\":$((5000 + i * 1100)).00,\"description\":\"savings\"}"
  tx withdrawal "{\"account_id\":\"$C\",\"amount\":$((120 + i * 30)).00,\"description\":\"cash\"}"
  tx transfer "{\"from_account_id\":\"$C\",\"to_account_id\":\"$S\",\"amount\":$((200 + i * 50)).00,\"description\":\"to savings\"}"

  EMAILS+=("$EMAIL"); TOKENS+=("$TOK"); CHEQ+=("$C"); CARDS+=("$K")
  ok "customer $i — chequing/savings/credit-card funded and active"
done

# ── 3. Card rails: authorize -> capture (interchange income) -> settle ───────
step "3/7  card rails — purchases through authorize/capture, then settlement"
MERCHANTS=("Loblaws" "Tim Hortons" "Petro-Canada" "Indigo" "Canadian Tire")
for idx in "${!CARDS[@]}"; do
  for j in 1 2; do
    AMT=$(( (idx + 1) * 40 + j * 27 ))
    AUTH=$(curl -fsS -XPOST "$API/api/v1/cards/authorize" -H "authorization: Bearer $SVC" \
      -H 'content-type: application/json' \
      -d "{\"account_id\":\"${CARDS[$idx]}\",\"amount\":${AMT}.00,\"merchant\":\"${MERCHANTS[$idx]}\"}" \
      | jget "['auth_id']")
    curl -fsS -XPOST "$API/api/v1/cards/capture" -H "authorization: Bearer $SVC" \
      -H 'content-type: application/json' -d "{\"auth_id\":\"$AUTH\"}" >/dev/null
  done
done
curl -fsS -XPOST "$API/api/v1/cards/settle" -H "authorization: Bearer $SVC" >/dev/null
ok "$(( ${#CARDS[@]} * 2 )) purchases captured and settled (interchange recognized)"

# ── 4. Interac e-Transfer (fee income) ──────────────────────────────────────
step "4/7  Interac e-Transfer"
if curl -fsS -XPOST "$API/api/v1/interac/etransfers" -H "authorization: Bearer ${TOKENS[0]}" \
     -H 'content-type: application/json' -d "{
       \"from_account_id\":\"${CHEQ[0]}\",\"amount\":75.00,
       \"recipient_handle_type\":\"email\",\"recipient_handle_value\":\"${EMAILS[1]}\",
       \"security_question\":\"City of birth?\",\"security_answer\":\"calgary\",
       \"memo\":\"rent split\"}" >/dev/null 2>&1; then
  ok "e-Transfer sent (fee income recognized)"
else
  echo "   ! e-Transfer skipped (rail not available)"
fi

# ── 5. Bank P&L for the period ──────────────────────────────────────────────
step "5/7  bank P&L — treasury/loan interest, funding cost, operating expense"
journal "interest earned — treasury placements" \
  "[$(leg cash_reserves debit 750.00),$(leg interest_income credit 750.00)]"
journal "interest earned — consumer loan book" \
  "[$(leg cash_reserves debit 1562.50),$(leg interest_income credit 1562.50)]"
journal "interest earned — card + overdraft book" \
  "[$(leg cash_reserves debit 1261.00),$(leg interest_income credit 1261.00)]"
journal "funding cost — wholesale deposits" \
  "[$(leg interest_expense debit 833.33),$(leg cash_reserves credit 833.33)]"
journal "operating expense — staff and technology" \
  "[$(leg operating_expense debit 1800.00),$(leg cash_reserves credit 1800.00)]"

# ── 6. Finance batches ──────────────────────────────────────────────────────
step "6/7  finance batches — daily accrual x${ACCRUAL_DAYS}, then capitalisation"
for d in $(seq "$ACCRUAL_DAYS" -1 1); do
  ASOF=$(date -d "-$d day" +%F)
  curl -fsS -XPOST "$API/api/v1/finance/accrue" -H "authorization: Bearer $SVC" \
    -H 'content-type: application/json' -d "{\"as_of\":\"$ASOF\"}" >/dev/null || true
done
ok "accrued interest for the last ${ACCRUAL_DAYS} days"
curl -fsS -XPOST "$API/api/v1/finance/capitalise" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d "{\"period\":\"$PERIOD\"}" >/dev/null || true
ok "capitalised $PERIOD (deposit/card interest + maintenance fees)"

# ── 7. Close the period into gl_snapshots ───────────────────────────────────
step "7/7  close period $PERIOD"
source finance/.venv/bin/activate
NANO_BANK_API="$API" python - "$PERIOD" <<'PY'
import sys
from finance.config import Settings
from finance.db import FinanceDB
from finance import ledger_client, snapshots

period = sys.argv[1]
s = Settings.from_env()
db = FinanceDB(s.db)
db.ensure_schema()
out = snapshots.close_period(period, ledger_client.get_balances(s.nano_bank_api), db)
print(f"   snapshot rows: {out.get('accounts', out)}")
PY
ok "period $PERIOD closed — the CFO can now report on it"

printf '\n\033[0;32mDemo bank seeded.\033[0m Ask the CFO about period %s.\n' "$PERIOD"
