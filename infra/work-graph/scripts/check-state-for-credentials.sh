#!/usr/bin/env bash
set -euo pipefail
umask 077

state_file="$(mktemp "${TMPDIR:-/tmp}/work-graph-state.XXXXXX.json")"
cleanup() {
  unlink "$state_file" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

terraform state pull >"$state_file"

if ! jq -e '
  ([.resources[]? | select(
    .type == "neon_project" or
    .type == "cloudflare_hyperdrive_config" or
    .type == "cloudflare_access_service_token" or
    .type == "cloudflare_zero_trust_access_service_token" or
    .type == "cloudflare_worker_secret" or
    .type == "cloudflare_workers_secret"
  )] | length == 0)
  and
  ([.. | strings | select(test("postgres(ql)?://[^/:@]+:[^/@]+@"))] | length == 0)
  and
  ([.outputs[]? | select(.sensitive == true)] | length == 0)
' "$state_file" >/dev/null; then
  echo "Work Graph Terraform state contains a forbidden credential-bearing resource, value, or output." >&2
  exit 1
fi

echo "Work Graph Terraform state contains IDs and non-credential metadata only."
