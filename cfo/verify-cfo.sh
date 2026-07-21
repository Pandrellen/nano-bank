#!/usr/bin/env bash
set -euo pipefail
# End-to-end CFO smoke. Prereqs (start these first, once per CORE_BACKEND):
#   - a core (modern :8091 or legacy :8090)
#   - bank API :8081  (CORE_BACKEND set accordingly)
#   - finance MCP :8088   (python -m finance.mcp_server)
#   - CFO API :8089       (OLLAMA_API_KEY=… python -m cfo.api_main)
CFO="${CFO_API_URL:-http://localhost:8089}"
PERIOD="${PERIOD:-$(date +%Y-%m)}"

echo "== CFO health =="
curl -fsS "$CFO/health" | tee /dev/stderr | grep -q '"status":"ok"'

echo "== ask the CFO for financial health ($PERIOD) =="
ANSWER=$(curl -fsS -XPOST "$CFO/ask" -H 'content-type: application/json' \
  -d "{\"message\":\"Close period $PERIOD if needed, then tell me our RAROC, ROE and overall financial health with the numbers.\"}" \
  | python -c 'import sys,json; print(json.load(sys.stdin)["answer"])')

echo "$ANSWER"
# The answer must contain at least one figure (digit); pure prose = fail.
echo "$ANSWER" | grep -Eq '[0-9]' || { echo "FAIL: no figures in CFO answer"; exit 1; }
echo "CFO SMOKE PASSED"
