#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

dry_run=false
if [[ "${1:-}" == "--dry-run" && $# -eq 1 ]]; then
  dry_run=true
elif (($# > 0)); then
  echo "Usage: deploy.sh [--dry-run]" >&2
  exit 2
fi

hyperdrive_id="${FINANCE_HYPERDRIVE_ID:-00000000000000000000000000000000}"
if [[ ! "$hyperdrive_id" =~ ^[0-9a-f]{32}$ ]]; then
  echo "FINANCE_HYPERDRIVE_ID must be a 32-character lowercase hexadecimal ID." >&2
  exit 1
fi
if [[ "$dry_run" != true ]]; then
  : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
  : "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
  if [[ "$hyperdrive_id" == "00000000000000000000000000000000" ]]; then
    echo "Cannot deploy the finance tax monitor with the placeholder Hyperdrive ID." >&2
    exit 1
  fi
fi

generated_config="$(mktemp ./.wrangler.finance-tax-monitor.XXXXXX.toml)"
bundle_dir=""
cleanup() {
  unlink "$generated_config" 2>/dev/null || true
  if [[ -n "$bundle_dir" && -d "$bundle_dir" ]]; then
    find "$bundle_dir" -type f -exec unlink {} + 2>/dev/null || true
    find "$bundle_dir" -depth -type d -empty -delete 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sed "s/00000000000000000000000000000000/$hyperdrive_id/" wrangler.toml >"$generated_config"
chmod 600 "$generated_config"

args=(deploy --config "$generated_config")
if [[ "$dry_run" == true ]]; then
  bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/finance-tax-monitor-bundle.XXXXXX")"
  args+=(--dry-run --outdir "$bundle_dir")
fi
pnpm exec wrangler "${args[@]}"
