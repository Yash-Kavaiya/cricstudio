#!/usr/bin/env bash
# Runs the same black-box session against the Node server and the Rust server, then compares.
# Usage (from the repo root): bash rust/golden/run-e2e.sh [debug|release]
set -u
PROFILE="${1:-debug}"
ROOT="$(pwd)"
WORK="$(mktemp -d)"
BIN="$ROOT/rust/target/$PROFILE/cricstudio"
common=(STREAM_KEY_SECRET=e2e-secret DEMO_BALL_MS=3600000 LOG_LEVEL=error HOST=127.0.0.1)

wait_up() { for _ in $(seq 1 150); do curl -fs "http://127.0.0.1:$1/api/health" >/dev/null 2>&1 && return 0; sleep 0.2; done; echo "server on :$1 did not start"; return 1; }
kill_port() { powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort $1 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1; }

env "${common[@]}" PORT=18801 DATA_DIR="$WORK/node" npx tsx apps/server/src/index.ts >"$WORK/node.log" 2>&1 &
wait_up 18801 || { tail -20 "$WORK/node.log"; exit 1; }
echo "--- Node server"
node rust/golden/e2e.mjs http://127.0.0.1:18801 "$WORK/node.json" 19351
kill_port 18801

env "${common[@]}" PORT=18802 DATA_DIR="$WORK/rust" "$BIN" >"$WORK/rust.log" 2>&1 &
wait_up 18802 || { tail -20 "$WORK/rust.log"; exit 1; }
echo "--- Rust server"
node rust/golden/e2e.mjs http://127.0.0.1:18802 "$WORK/rust.json" 19352
kill_port 18802

echo "--- Comparison"
node rust/golden/compare.mjs "$WORK/node.json" "$WORK/rust.json"
status=$?
echo "transcripts and logs: $WORK"
exit $status
