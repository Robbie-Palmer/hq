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

if [[ "$dry_run" != true && "${WORK_GRAPH_DOPPLER_WRAPPED:-}" != "1" ]]; then
  missing=false
  for name in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN WORK_GRAPH_HYPERDRIVE_ID; do
    if [[ -z "${!name:-}" ]]; then
      missing=true
    fi
  done
  if [[ "$missing" == true ]]; then
    if ! command -v doppler >/dev/null 2>&1; then
      echo "Cannot deploy Work Graph: required values are missing and doppler is unavailable." >&2
      exit 1
    fi
    export WORK_GRAPH_DOPPLER_WRAPPED=1
    exec doppler run \
      --project "${DOPPLER_PROJECT:-work-graph}" \
      --config "${DOPPLER_WORK_GRAPH_CONFIG:-prd_work_graph}" \
      --preserve-env=WORK_GRAPH_DOPPLER_WRAPPED,DOPPLER_PROJECT,DOPPLER_WORK_GRAPH_CONFIG \
      -- bash "$0"
  fi
fi

hyperdrive_id="${WORK_GRAPH_HYPERDRIVE_ID:-00000000000000000000000000000000}"
if [[ ! "$hyperdrive_id" =~ ^[0-9a-f]{32}$ ]]; then
  echo "Cannot deploy Work Graph: WORK_GRAPH_HYPERDRIVE_ID must be a 32-character lowercase hexadecimal ID." >&2
  exit 1
fi
if [[ "$dry_run" != true ]]; then
  : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
  : "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
  if [[ "$hyperdrive_id" == "00000000000000000000000000000000" ]]; then
    echo "Cannot deploy Work Graph with the placeholder Hyperdrive ID." >&2
    exit 1
  fi
fi

generated_config="$(mktemp ./.wrangler.work-graph.XXXXXX.toml)"
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
  bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-worker-bundle.XXXXXX")"
  args+=(--dry-run --outdir "$bundle_dir")
fi
pnpm exec wrangler "${args[@]}"
