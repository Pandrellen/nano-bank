#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== cluster B: modern core =="
( cd ../nano-bank-modern-core && ./k8s/deploy.sh )
echo "== cluster A: bank + agent =="
./k8s/deploy.sh          # postgres + bank-api + cross-cluster wiring
./agent/k8s/deploy.sh    # qdrant + mcp + api + console + secret
echo "✅ full stack up"
echo "   UI:  http://localhost:3000"
echo "   API: http://localhost:8081 (in-cluster)"
echo "   Backend e2e: ./agent/e2e_test.sh    UI e2e: ./scripts/e2e-ui.sh"
