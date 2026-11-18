#!/usr/bin/env bash
set -euo pipefail

port="${WORK_GRAPH_LOCAL_SMOKE_PORT:-18799}"
log_file="$(mktemp "${TMPDIR:-/tmp}/work-graph-local-smoke.XXXXXX.log")"
worker_pid=""

cleanup() {
  if [[ -n "$worker_pid" ]]; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  unlink "$log_file" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://smoke:smoke@127.0.0.1:1/smoke" \
  pnpm exec wrangler dev --local --port "$port" --log-level error \
  >"$log_file" 2>&1 &
worker_pid="$!"

for _attempt in {1..80}; do
  if curl --silent --output /dev/null "http://127.0.0.1:${port}/__runtime_smoke__"; then
    exit 0
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  sleep 0.25
done

cat "$log_file" >&2
echo "Work Graph local Worker did not start within 20 seconds" >&2
exit 1
