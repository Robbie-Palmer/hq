#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Pass preview or apply as the credential mode}"
shift

project="${DOPPLER_MINIMAL_BOOTSTRAP_PROJECT:-platform-bootstrap-canary}"
case "$mode" in
  preview)
    config="${DOPPLER_MINIMAL_BOOTSTRAP_PREVIEW_CONFIG:-preview}"
    ;;
  apply)
    config="${DOPPLER_MINIMAL_BOOTSTRAP_APPLY_CONFIG:-apply}"
    ;;
  *)
    echo "Unknown minimal-bootstrap credential mode: $mode" >&2
    exit 1
    ;;
esac

if [[ "${DOPPLER_MINIMAL_BOOTSTRAP_ENV_WRAPPED:-}" != "$mode" ]]; then
  if ! command -v doppler >/dev/null 2>&1; then
    echo "Cannot run the minimal bootstrap: doppler is required." >&2
    exit 1
  fi
  export DOPPLER_MINIMAL_BOOTSTRAP_ENV_WRAPPED="$mode"
  exec doppler run \
    --project "$project" \
    --config "$config" \
    --preserve-env=DOPPLER_MINIMAL_BOOTSTRAP_PROJECT,DOPPLER_MINIMAL_BOOTSTRAP_PREVIEW_CONFIG,DOPPLER_MINIMAL_BOOTSTRAP_APPLY_CONFIG,DOPPLER_MINIMAL_BOOTSTRAP_ENV_WRAPPED,MINIMAL_BOOTSTRAP_REVIEWER_EMAIL \
    -- bash "$0" "$mode" "$@"
fi

set_if_unset() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "${!name:-}" && -n "$value" ]]; then
    export "$name=$value"
  fi
}

reviewer_email="${MINIMAL_BOOTSTRAP_REVIEWER_EMAIL:-$(git config user.email)}"
if [[ -z "$reviewer_email" ]]; then
  echo "MINIMAL_BOOTSTRAP_REVIEWER_EMAIL or git user.email is required." >&2
  exit 1
fi

set_if_unset TF_TOKEN_app_terraform_io "${TF_API_TOKEN:-}"
set_if_unset TF_VAR_cloudflare_account_id "${CLOUDFLARE_ACCOUNT_ID:-}"
set_if_unset TF_VAR_cloudflare_zone_id "${CLOUDFLARE_ZONE_ID:-}"
set_if_unset TF_VAR_neon_org_id "${NEON_ORG_ID:-}"
set_if_unset TF_VAR_reviewer_emails "$(jq -cn --arg email "$reviewer_email" '[$email]')"

for required_name in \
  TF_TOKEN_app_terraform_io \
  CLOUDFLARE_API_TOKEN \
  TF_VAR_cloudflare_account_id \
  TF_VAR_cloudflare_zone_id \
  NEON_API_KEY \
  TF_VAR_neon_org_id; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "Cannot run the minimal bootstrap: $required_name is missing." >&2
    exit 1
  fi
done

exec "$@"
