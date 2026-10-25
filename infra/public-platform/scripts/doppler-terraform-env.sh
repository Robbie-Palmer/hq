#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-personal-site}"
pages_env_config="${DOPPLER_PAGES_ENV_CONFIG:-dev_pages_env}"
infra_config="${DOPPLER_INFRA_CONFIG:-dev_infra}"

if [ "${DOPPLER_TERRAFORM_ENV_WRAPPED:-}" != "1" ]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_TERRAFORM_ENV_WRAPPED=1
    exec doppler run --project "$project" --config "$pages_env_config" -- doppler run \
      --project "$project" \
      --config "$infra_config" \
      --preserve-env=CF_IMAGES_ACCOUNT_HASH,NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH,POSTHOG_KEY,NEXT_PUBLIC_POSTHOG_KEY,POSTHOG_HOST,NEXT_PUBLIC_POSTHOG_HOST,POSTHOG_OTLP_BASE_URL,RECIPE_API_URL,RECIPE_API_PREVIEW_ORIGIN_TEMPLATE,CF_PAGES_HOST \
      -- bash "$0" "$@"
  elif [ "${CI:-}" != "true" ]; then
    echo "Cannot run Terraform locally: doppler is required." >&2
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
set_if_unset TF_VAR_cf_images_account_hash "${CF_IMAGES_ACCOUNT_HASH:-${NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH:-}}"
set_if_unset TF_VAR_github_token "${MISE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
set_if_unset TF_VAR_neon_org_id "${NEON_ORG_ID:-}"
set_if_unset TF_VAR_posthog_host "${POSTHOG_HOST:-${NEXT_PUBLIC_POSTHOG_HOST:-}}"
set_if_unset TF_VAR_posthog_key "${POSTHOG_KEY:-${NEXT_PUBLIC_POSTHOG_KEY:-}}"
set_if_unset TF_VAR_posthog_otlp_base_url "${POSTHOG_OTLP_BASE_URL:-}"
set_if_unset TF_VAR_posthog_project_id "${POSTHOG_PROJECT_ID:-}"
# POSTHOG_API_KEY is canonical; this fallback can be removed once all Doppler
# configs have migrated away from POSTHOG_PERSONAL_API_KEY.
set_if_unset POSTHOG_API_KEY "${POSTHOG_PERSONAL_API_KEY:-}"
set_if_unset TF_VAR_posthog_api_key "${POSTHOG_API_KEY:-}"
set_if_unset TF_VAR_recipe_api_preview_origin_template "${RECIPE_API_PREVIEW_ORIGIN_TEMPLATE:-}"
set_if_unset TF_VAR_recipe_api_url "${RECIPE_API_URL:-}"
set_if_unset TF_VAR_cf_pages_host "${CF_PAGES_HOST:-}"
set_if_unset TF_VAR_slack_webhook_url "${CLOUDFLARE_SLACK_WEBHOOK_URL:-}"

exec "$@"
