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

if [[ "$dry_run" != true && "${WORK_GRAPH_OBSERVER_DOPPLER_WRAPPED:-}" != "1" ]]; then
  missing=false
  for name in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN GITHUB_ALLOWED_INSTALLATION_IDS GITHUB_ALLOWED_REPOSITORIES GITHUB_WEBHOOK_SECRET; do
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

if [[ "$dry_run" == true ]]; then
  bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-observer-bundle.XXXXXX")"
  trap 'find "$bundle_dir" -depth -delete 2>/dev/null || true' EXIT INT TERM
  ./node_modules/.bin/wrangler deploy --dry-run --outdir "$bundle_dir"
  exit
fi

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${GITHUB_WEBHOOK_SECRET:?GITHUB_WEBHOOK_SECRET is required}"
: "${GITHUB_ALLOWED_INSTALLATION_IDS:?GITHUB_ALLOWED_INSTALLATION_IDS is required}"
: "${GITHUB_ALLOWED_REPOSITORIES:?GITHUB_ALLOWED_REPOSITORIES is required}"

secret_file="$(mktemp "${TMPDIR:-/tmp}/work-graph-observer-secrets.XXXXXX.json")"
cleanup() {
  unlink "$secret_file" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

jq -n '{
  GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
  GITHUB_ALLOWED_INSTALLATION_IDS: env.GITHUB_ALLOWED_INSTALLATION_IDS,
  GITHUB_ALLOWED_REPOSITORIES: env.GITHUB_ALLOWED_REPOSITORIES
}' >"$secret_file"
chmod 600 "$secret_file"

./node_modules/.bin/wrangler secret bulk "$secret_file"
./node_modules/.bin/wrangler deploy
