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
