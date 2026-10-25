#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wrapper="$script_dir/doppler-terraform-env.sh"

assert_fails_with() {
  local expected="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "Expected failure to contain '$expected'." >&2
    exit 1
  fi
}

assert_fails_with \
  "doppler is required" \
  env -u CI -u DOPPLER_TAILNET_ENV_WRAPPED PATH=/usr/bin:/bin \
  bash "$wrapper" plan true

assert_fails_with \
  "TF_API_TOKEN is missing" \
  env CI=true DOPPLER_TAILNET_ENV_WRAPPED=1 \
  bash "$wrapper" plan true

env \
  CI=true \
  DOPPLER_TAILNET_ENV_WRAPPED=1 \
  TF_API_TOKEN=test-terraform-token \
  TAILSCALE_OAUTH_CLIENT_ID=test-client-id \
  TAILSCALE_OAUTH_CLIENT_SECRET=test-client-secret \
  TAILSCALE_TAILNET=example.ts.net \
  TAILNET_USER_LOGIN_OPERATOR=operator@example.com \
  TAILNET_PRIVATE_ADDRESS_PRIMARY_DNS=100.64.0.1 \
  TAILNET_UNRELATED_VALUE=ignored \
  bash "$wrapper" plan bash -c '
    set -euo pipefail
    [[ "$TF_TOKEN_app_terraform_io" == "test-terraform-token" ]]
    [[ "$(jq -r .operator <<<"$TF_VAR_user_logins")" == "operator@example.com" ]]
    [[ "$(jq -r .primary_dns <<<"$TF_VAR_private_addresses")" == "100.64.0.1" ]]
    [[ "$(jq length <<<"$TF_VAR_user_logins")" == "1" ]]
    [[ "$(jq length <<<"$TF_VAR_private_addresses")" == "1" ]]
  '
