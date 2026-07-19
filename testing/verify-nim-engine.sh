#!/usr/bin/env bash
# Cross-backend smoke for the interest / NIM engine (spec #2). Drives the real
# endpoints against whichever core nano-bank is currently pointed at, and checks
# the deposit-interest accrual → capitalisation → maintenance-fee path plus card
# interchange income. Run once per CORE_BACKEND.
#
# Prereq: Kind Postgres up; a core (modern or legacy) up; nano-bank on :8081
# running against it. Example:
#   CORE_BACKEND=modern bash testing/verify-nim-engine.sh
set -euo pipefail
API="${API:-http://localhost:8081}"
SERVICE_SECRET="${SERVICE_SECRET:-nano-bank-visa-network-secret-change-me}"
PW="verifypass123"

jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

echo "==> health"
curl -fsS "$API/health" >/dev/null

echo "==> mint service token"
SVC=$(curl -fsS -X POST "$API/api/v1/auth/service-token" \
  -H 'content-type: application/json' \
  -d "{\"client_secret\":\"$SERVICE_SECRET\"}" | jget "['access_token']")

echo "==> create customer + login"
N=$RANDOM$RANDOM
EMAIL="nimverify_${N}@example.com"
curl -fsS -X POST "$API/api/v1/customers" -H 'content-type: application/json' -d "{
  \"email\":\"$EMAIL\",\"phone_number\":\"$(printf '%010d' $((N%10000000000)))\",
  \"first_name\":\"Nim\",\"last_name\":\"Verify\",\"date_of_birth\":\"1990-01-01\",
  \"sin\":\"$(printf '%09d' $((N%1000000000)))\",\"password\":\"$PW\"}" >/dev/null
TOKEN=$(curl -fsS -X POST "$API/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | jget "['access_token']")

echo "==> open chequing + deposit \$1000"
ACCT=$(curl -fsS -X POST "$API/api/v1/accounts" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"account_type":"chequing"}' | jget "['account_id']")
curl -fsS -X POST "$API/api/v1/transactions/deposit" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"account_id\":\"$ACCT\",\"amount\":1000.00,\"description\":\"seed\"}" >/dev/null

# Unique far-future period so the batch idempotency doesn't collide across runs.
YEAR=$((2300 + RANDOM % 300))
PERIOD="${YEAR}-06"
ASOF="${YEAR}-06-15"

echo "==> accrue $ASOF"
EXP=$(curl -fsS -X POST "$API/api/v1/finance/accrue" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d "{\"as_of\":\"$ASOF\"}" | jget "['expense_total']")
echo "    expense_total=$EXP"

echo "==> capitalise $PERIOD"
curl -fsS -X POST "$API/api/v1/finance/capitalise" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d "{\"period\":\"$PERIOD\"}" >/dev/null

BAL=$(curl -fsS "$API/api/v1/accounts/$ACCT/balance" -H "authorization: Bearer $TOKEN" | jget "['balance']")
echo "    balance after capitalisation = $BAL (expect 996.08: 1000 + 0.08 interest - 4.00 maintenance)"
python3 -c "import sys; b=float('$BAL'); sys.exit(0 if abs(b-996.08)<1e-6 else 1)" \
  || { echo "FAIL: expected 996.08, got $BAL"; exit 1; }

echo "==> card interchange: open card, authorize + capture \$100"
CARD=$(curl -fsS -X POST "$API/api/v1/accounts" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"account_type":"credit_card"}' | jget "['account_id']")
AUTH=$(curl -fsS -X POST "$API/api/v1/cards/authorize" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' \
  -d "{\"account_id\":\"$CARD\",\"amount\":100.00,\"merchant\":\"Verify\"}" | jget "['auth_id']")
curl -fsS -X POST "$API/api/v1/cards/capture" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d "{\"auth_id\":\"$AUTH\"}" >/dev/null
INTER=$(curl -fsS "$API/api/v1/ledger/balances" | python3 -c "
import sys,json
b=json.load(sys.stdin)
v=sum(abs(float(a['balance'])) for a in b if a['account'] in ('INTERCHANGE','0000800200'))
print(v)")
echo "    interchange income balance = $INTER (expect >= 1.50)"
python3 -c "import sys; sys.exit(0 if float('$INTER')>=1.50 else 1)" \
  || { echo "FAIL: interchange income not recognized"; exit 1; }

echo "NIM ENGINE VERIFY: PASS"
