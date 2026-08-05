#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🌱 Seeding demo account (requires the stack up: ./scripts/deploy-all.sh)"
PY="agent/.venv/bin/python"
[ -x "$PY" ] || { echo "❌ $PY not found — run agent setup first"; exit 1; }

# bank-api is ClusterIP-only; port-forward it for the seeder.
kubectl -n nano-bank port-forward svc/bank-api 8081:8081 >/tmp/demo-seed-pf.log 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT

echo "⏳ waiting for bank-api on :8081 ..."
for _ in $(seq 1 30); do
  curl -fsS http://localhost:8081/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://localhost:8081/health >/dev/null || { echo "❌ bank-api not reachable"; exit 1; }

"$PY" testing/demo/seed_demo_account.py --api http://localhost:8081
