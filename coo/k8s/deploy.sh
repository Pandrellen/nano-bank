#!/usr/bin/env bash
# Deploy the COO stack (operations MCP + COO agent) into the kind nano-bank
# cluster. Mirrors agent/k8s/deploy.sh. Assumes the platform prereqs are already
# up in the cluster:
#   - bank-api   (k8s/deploy.sh)      — the operations MCP reads it over HTTP
#   - agent-qdrant (agent/k8s/qdrant.yaml) — COO durable memory (best-effort)
#   - nano-agent-secrets              — provides OLLAMA_API_KEY (minted here if absent)
#
# Note on data: a COO review is grounded but reads ZERO until money has moved.
# Seeding non-zero activity needs a GL core for the Ledger port to post to (the
# separate modern-core cluster) — see scripts/deploy-all.sh. For a quick non-zero
# demo without k8s, use the host path: testing/seed-demo.sh + coo/verify-coo.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."          # -> repo root
CTX=kind-nano-bank

echo "🐳 Building + loading images..."
docker build -t nano-operations-mcp:dev operations
docker build -t nano-coo:dev            coo
kind load docker-image nano-operations-mcp:dev nano-coo:dev --name nano-bank

if ! kubectl --context "$CTX" -n nano-bank get secret nano-agent-secrets >/dev/null 2>&1; then
  echo "🔐 Minting nano-agent-secrets (OLLAMA_API_KEY from .env)..."
  [ -f .env ] || { echo "❌ .env missing (need OLLAMA_API_KEY=…)"; exit 1; }
  OLLAMA_API_KEY=$(grep -E '^OLLAMA_API_KEY=' .env | cut -d= -f2-)
  [ -n "$OLLAMA_API_KEY" ] || { echo "❌ OLLAMA_API_KEY empty in .env"; exit 1; }
  kubectl --context "$CTX" create secret generic nano-agent-secrets -n nano-bank \
    --from-literal=OLLAMA_API_KEY="$OLLAMA_API_KEY" \
    --dry-run=client -o yaml | kubectl --context "$CTX" apply -f -
else
  echo "🔐 nano-agent-secrets already present — leaving it untouched."
fi

echo "📦 Applying manifests..."
kubectl --context "$CTX" apply -f operations/k8s/operations-mcp.yaml
kubectl --context "$CTX" apply -f coo/k8s/coo.yaml
kubectl --context "$CTX" -n nano-bank rollout status deploy/operations-mcp --timeout=180s
kubectl --context "$CTX" -n nano-bank rollout status deploy/coo            --timeout=240s

echo "✅ COO stack up. Health:"
POD=$(kubectl --context "$CTX" get pod -n nano-bank -l app=coo -o jsonpath='{.items[0].metadata.name}')
kubectl --context "$CTX" exec -n nano-bank "$POD" -- \
  python -c 'import urllib.request,json; print(json.dumps(json.load(urllib.request.urlopen("http://localhost:8093/health"))))'
