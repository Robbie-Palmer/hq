#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-homelab}"
infra_config="${DOPPLER_PERSONAL_ARCHIVE_INFRA_CONFIG:-prd_personal_archive_infra}"

if [[ "${DOPPLER_PERSONAL_ARCHIVE_TERRAFORM_ENV_WRAPPED:-}" != "1" ]]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_PERSONAL_ARCHIVE_TERRAFORM_ENV_WRAPPED=1
    exec doppler run \
      --project "$project" \
      --config "$infra_config" \
      -- bash "$0" "$@"
  elif [[ "${CI:-}" != "true" ]]; then
    echo "Cannot run personal-archive Terraform locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then run this command again." >&2
    exit 1
  fi
fi

terraform_token_environment=()
if [[ -z "${TF_TOKEN_app_terraform_io:-}" ]] && [[ -n "${TF_API_TOKEN:-}" ]]; then
  terraform_token_environment=("TF_TOKEN_app_terraform_io=${TF_API_TOKEN}")
fi

exec env "${terraform_token_environment[@]}" "$@"
