#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-personal-site}"
bootstrap_infra_config="${DOPPLER_BOOTSTRAP_INFRA_CONFIG:-dev_bootstrap_infra}"

if [ "${DOPPLER_BOOTSTRAP_TERRAFORM_ENV_WRAPPED:-}" != "1" ]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_BOOTSTRAP_TERRAFORM_ENV_WRAPPED=1
    exec doppler run \
      --project "$project" \
      --config "$bootstrap_infra_config" \
      -- bash "$0" "$@"
  elif [ "${CI:-}" != "true" ]; then
    echo "Cannot run bootstrap Terraform locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then run this command again." >&2
    exit 1
  fi
fi

set_if_unset() {
  local name="$1"
  local value="${2:-}"

  if [ -z "${!name:-}" ] && [ -n "$value" ]; then
    export "$name=$value"
  fi
}

set_if_unset TF_TOKEN_app_terraform_io "${TF_API_TOKEN:-}"
set_if_unset TF_VAR_gcp_project_id "${GCP_PROJECT_ID:-}"

exec "$@"
