#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-work-graph}"
infra_config="${DOPPLER_WORK_GRAPH_INFRA_CONFIG:-prd_work_graph_infra}"

if [[ "${DOPPLER_WORK_GRAPH_TERRAFORM_ENV_WRAPPED:-}" != "1" ]]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_WORK_GRAPH_TERRAFORM_ENV_WRAPPED=1
    exec doppler run \
      --project "$project" \
      --config "$infra_config" \
      --preserve-env=DOPPLER_PROJECT,DOPPLER_WORK_GRAPH_INFRA_CONFIG,DOPPLER_WORK_GRAPH_TERRAFORM_ENV_WRAPPED \
      -- bash "$0" "$@"
  elif [[ "${CI:-}" != "true" ]]; then
    echo "Cannot run Work Graph Terraform locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then retry." >&2
    exit 1
  fi
fi

set_if_unset() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "${!name:-}" && -n "$value" ]]; then
    export "$name=$value"
  fi
}

set_if_unset TF_TOKEN_app_terraform_io "${TF_API_TOKEN:-}"
set_if_unset TF_VAR_cloudflare_account_id "${CLOUDFLARE_ACCOUNT_ID:-}"
set_if_unset TF_VAR_neon_org_id "${NEON_ORG_ID:-}"

exec "$@"
