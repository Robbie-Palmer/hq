#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-homelab}"
infra_config="${DOPPLER_REMOTE_DEVELOPMENT_INFRA_CONFIG:-prd_remote_development_infra}"

if [ "${DOPPLER_REMOTE_DEVELOPMENT_TERRAFORM_ENV_WRAPPED:-}" != "1" ]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_REMOTE_DEVELOPMENT_TERRAFORM_ENV_WRAPPED=1
    exec doppler run \
      --project "$project" \
      --config "$infra_config" \
      -- bash "$0" "$@"
  elif [ "${CI:-}" != "true" ]; then
    echo "Cannot run remote-development Terraform locally: doppler is required." >&2
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

set_if_unset HCLOUD_TOKEN "${HETZNER_CLOUD_TOKEN:-}"
set_if_unset TF_TOKEN_app_terraform_io "${TF_API_TOKEN:-}"
set_if_unset TF_VAR_ssh_public_key "${SSH_PUBLIC_KEY:-}"
set_if_unset TF_VAR_bootstrap_ssh_cidrs "${BOOTSTRAP_SSH_CIDRS:-}"
set_if_unset TF_VAR_bootstrap_mode_enabled "${BOOTSTRAP_MODE_ENABLED:-}"

exec "$@"
