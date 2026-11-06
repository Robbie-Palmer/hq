#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Usage: doppler-terraform-env.sh <plan|drift|apply> <command> [args...]}"
shift

case "$mode" in
  plan) config="${DOPPLER_PERSONAL_FINANCE_PLAN_CONFIG:-ops}" ;;
  drift) config="${DOPPLER_PERSONAL_FINANCE_DRIFT_CONFIG:-drift}" ;;
  apply) config="${DOPPLER_PERSONAL_FINANCE_APPLY_CONFIG:-apply}" ;;
  *)
    echo "Unknown Personal Finance credential mode: $mode" >&2
    exit 2
    ;;
esac

project="${DOPPLER_PERSONAL_FINANCE_PROJECT:-personal-finance}"

export_terraform_input() {
  local source_name="$1"
  local target_name="$2"
  local value="${!source_name:-}"
  if [[ -n "$value" ]]; then
    printf -v "$target_name" '%s' "$value"
    export "$target_name"
  fi
}

if [[ "${DOPPLER_PERSONAL_FINANCE_ENV_WRAPPED:-}" != "1" ]]; then
  if command -v doppler >/dev/null 2>&1 && [[ "${CI:-}" != "true" ]]; then
    export DOPPLER_PERSONAL_FINANCE_ENV_WRAPPED=1
    exec doppler run \
      --project "$project" \
      --config "$config" \
      --preserve-env=DOPPLER_PERSONAL_FINANCE_PROJECT,DOPPLER_PERSONAL_FINANCE_PLAN_CONFIG,DOPPLER_PERSONAL_FINANCE_DRIFT_CONFIG,DOPPLER_PERSONAL_FINANCE_APPLY_CONFIG,DOPPLER_PERSONAL_FINANCE_ENV_WRAPPED \
      -- bash "$0" "$mode" "$@"
  elif [[ "${CI:-}" != "true" ]]; then
    echo "Cannot run Personal Finance Terraform locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then retry." >&2
    exit 1
  fi
fi

if [[ -z "${TF_API_TOKEN:-}" ]]; then
  echo "Cannot run Personal Finance $mode: TF_API_TOKEN is missing." >&2
  exit 1
fi

if [[ -z "${TF_TOKEN_app_terraform_io:-}" ]]; then
  export TF_TOKEN_app_terraform_io="$TF_API_TOKEN"
fi

export_terraform_input PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_ACCESS TF_VAR_cloudflare_access
export_terraform_input PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_R2 TF_VAR_cloudflare_r2
export_terraform_input PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_WORKER TF_VAR_cloudflare_worker
export_terraform_input PERSONAL_FINANCE_TERRAFORM_NEON TF_VAR_neon
export_terraform_input PERSONAL_FINANCE_TERRAFORM_POSTHOG_ALERTING TF_VAR_posthog_alerting
export_terraform_input PERSONAL_FINANCE_TERRAFORM_TELEMETRY TF_VAR_telemetry
export_terraform_input POSTHOG_API_KEY TF_VAR_posthog_api_key

exec "$@"
