#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

UI_URL="${UI_BASE_URL:-http://localhost:3000}"
echo "🔎 Checking UI at ${UI_URL} ..."
if ! curl -fsS "${UI_URL}" >/dev/null 2>&1; then
  echo "❌ UI not reachable at ${UI_URL}. Bring the stack up first: ./scripts/deploy-all.sh"
  exit 1
fi

cd ui
npx playwright install chromium >/dev/null 2>&1 || true
UI_BASE_URL="${UI_URL}" npx playwright test
