#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
worker_dir="$(cd -- "$script_dir/.." && pwd)"
wrangler="$worker_dir/node_modules/.bin/wrangler"

if [[ ! -x "$wrangler" ]]; then
  echo "Cannot deploy the observer: run the observer install task first." >&2
  exit 1
fi

dry_run=false
if [[ "${1:-}" == "--dry-run" && $# -eq 1 ]]; then
  dry_run=true
elif (($# > 0)); then
  echo "Usage: deploy.sh [--dry-run]" >&2
  exit 2
fi

if [[ "$dry_run" != true && "${WORK_GRAPH_OBSERVER_DOPPLER_WRAPPED:-}" != "1" ]]; then
  missing=false
  for name in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN WORK_GRAPH_HYPERDRIVE_ID GITHUB_ALLOWED_INSTALLATION_IDS GITHUB_ALLOWED_REPOSITORIES GITHUB_WEBHOOK_SECRET; do
    if [[ -z "${!name:-}" ]]; then
      missing=true
    fi
  done
  if [[ "$missing" == true ]]; then
    if ! command -v doppler >/dev/null 2>&1; then
      echo "Cannot deploy the observer: required values are missing and doppler is unavailable." >&2
      exit 1
    fi
    export WORK_GRAPH_OBSERVER_DOPPLER_WRAPPED=1
    exec doppler run \
      --project "${DOPPLER_PROJECT:-work-graph}" \
      --config "${DOPPLER_WORK_GRAPH_CONFIG:-prd_work_graph}" \
      --preserve-env=WORK_GRAPH_OBSERVER_DOPPLER_WRAPPED,DOPPLER_PROJECT,DOPPLER_WORK_GRAPH_CONFIG \
      -- bash "$0"
  fi
fi

hyperdrive_id="${WORK_GRAPH_HYPERDRIVE_ID:-00000000000000000000000000000000}"
if [[ ! "$hyperdrive_id" =~ ^[0-9a-f]{32}$ ]] ||
  [[ "$dry_run" != true && "$hyperdrive_id" == "00000000000000000000000000000000" ]]; then
  echo "Cannot deploy the observer without a valid WORK_GRAPH_HYPERDRIVE_ID." >&2
  exit 1
fi
generated_config="$(mktemp "$worker_dir/.wrangler.observer.XXXXXX.toml")"
bundle_dir=""
secret_file=""
cleanup() {
  unlink "$generated_config" 2>/dev/null || true
  [[ -z "$secret_file" ]] || unlink "$secret_file" 2>/dev/null || true
  [[ -z "$bundle_dir" ]] || find "$bundle_dir" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM
sed "s/00000000000000000000000000000000/$hyperdrive_id/" "$worker_dir/wrangler.toml" >"$generated_config"
chmod 600 "$generated_config"

if [[ "$dry_run" == true ]]; then
  bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-observer-bundle.XXXXXX")"
  (cd "$worker_dir" && "$wrangler" deploy --config "$generated_config" --dry-run --outdir "$bundle_dir")
  exit
fi

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${GITHUB_WEBHOOK_SECRET:?GITHUB_WEBHOOK_SECRET is required}"
: "${GITHUB_ALLOWED_INSTALLATION_IDS:?GITHUB_ALLOWED_INSTALLATION_IDS is required}"
: "${GITHUB_ALLOWED_REPOSITORIES:?GITHUB_ALLOWED_REPOSITORIES is required}"

secret_file="$(mktemp "${TMPDIR:-/tmp}/work-graph-observer-secrets.XXXXXX.json")"

jq -n '{
  GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
  GITHUB_ALLOWED_INSTALLATION_IDS: env.GITHUB_ALLOWED_INSTALLATION_IDS,
  GITHUB_ALLOWED_REPOSITORIES: env.GITHUB_ALLOWED_REPOSITORIES
}' >"$secret_file"
chmod 600 "$secret_file"

(cd "$worker_dir" && "$wrangler" secret bulk "$secret_file" --config "$generated_config")
(cd "$worker_dir" && "$wrangler" deploy --config "$generated_config")
