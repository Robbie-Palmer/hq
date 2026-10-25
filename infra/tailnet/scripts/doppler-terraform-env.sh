#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Usage: doppler-terraform-env.sh <plan|apply> <command> [args...]}"
shift

case "$mode" in
  plan) config="${DOPPLER_TAILNET_PLAN_CONFIG:-prd_tailnet_infra_plan}" ;;
  apply) config="${DOPPLER_TAILNET_APPLY_CONFIG:-prd_tailnet_infra}" ;;
  *)
    echo "Unknown tailnet credential mode: $mode" >&2
    exit 2
    ;;
esac

project="${DOPPLER_PROJECT:-homelab}"

if [[ "${DOPPLER_TAILNET_ENV_WRAPPED:-}" != "1" && "${CI:-}" != "true" ]]; then
  if ! command -v doppler >/dev/null 2>&1; then
    echo "Cannot run tailnet Terraform locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then retry." >&2
    exit 1
  fi
  export DOPPLER_TAILNET_ENV_WRAPPED=1
  exec doppler run \
    --project "$project" \
    --config "$config" \
    --preserve-env=CI,DOPPLER_PROJECT,DOPPLER_TAILNET_PLAN_CONFIG,DOPPLER_TAILNET_APPLY_CONFIG,DOPPLER_TAILNET_ENV_WRAPPED \
    -- bash "$0" "$mode" "$@"
fi

for required_name in \
  TF_API_TOKEN \
  TAILSCALE_OAUTH_CLIENT_ID \
  TAILSCALE_OAUTH_CLIENT_SECRET \
  TAILSCALE_TAILNET; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "Cannot run tailnet $mode: $required_name is missing." >&2
    exit 1
  fi
done

set_if_unset() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "${!name:-}" && -n "$value" ]]; then
    export "$name=$value"
  fi
}

set_if_unset TF_TOKEN_app_terraform_io "$TF_API_TOKEN"

map_prefixed_values() {
  local prefix="$1"
  local target="$2"
  local mapped='{}'
  local source_name key value

  while IFS= read -r source_name; do
    [[ "$source_name" == "$prefix"* ]] || continue
    key="${source_name#"$prefix"}"
    key="${key,,}"
    value="${!source_name:-}"
    [[ -n "$value" ]] || continue
    mapped="$(
      TAILNET_MAP_CURRENT="$mapped" \
      TAILNET_MAP_KEY="$key" \
      TAILNET_MAP_VALUE="$value" \
        jq -cn 'env.TAILNET_MAP_CURRENT | fromjson | . + {(env.TAILNET_MAP_KEY): env.TAILNET_MAP_VALUE}'
    )"
  done < <(compgen -v | LC_ALL=C sort)

  export "$target=$mapped"
}

map_prefixed_values TAILNET_USER_LOGIN_ TF_VAR_user_logins
map_prefixed_values TAILNET_PRIVATE_ADDRESS_ TF_VAR_private_addresses

exec "$@"
