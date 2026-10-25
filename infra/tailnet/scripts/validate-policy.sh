#!/usr/bin/env bash
set -euo pipefail

validation_dir="$(mktemp -d "${TMPDIR:-/tmp}/tailnet-policy-validation.XXXXXX")"
trap 'rm -rf "$validation_dir"' EXIT

policy_file="$validation_dir/policy.json"
console_file="$validation_dir/console.json"
token_file="$validation_dir/token.json"
response_file="$validation_dir/response.json"

printf '%s\n' 'nonsensitive(jsonencode(local.tailnet_policy))' \
  | terraform console >"$console_file"
jq -er '.' "$console_file" >"$policy_file"

curl --fail --silent --show-error \
  --user "$TAILSCALE_OAUTH_CLIENT_ID:$TAILSCALE_OAUTH_CLIENT_SECRET" \
  --data-urlencode grant_type=client_credentials \
  https://api.tailscale.com/api/v2/oauth/token >"$token_file"

access_token="$(jq -er '.access_token' "$token_file")"
tailnet_path="$(jq -nr --arg tailnet "$TAILSCALE_TAILNET" '$tailnet | @uri')"

status="$({
  curl --silent --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer $access_token" \
    --header 'Content-Type: application/json' \
    --data-binary "@$policy_file" \
    "https://api.tailscale.com/api/v2/tailnet/$tailnet_path/acl/validate"
})"

if [[ "$status" != "200" ]]; then
  echo "Tailscale policy validation request failed with HTTP $status." >&2
  exit 1
fi

if [[ -s "$response_file" ]] && jq -e '.message? | length > 0' "$response_file" >/dev/null; then
  echo "Tailscale rejected the rendered policy." >&2
  jq -r '[.message, (.data[]?.errors[]?)] | .[] | select(. != null)' "$response_file" \
    | sed -E \
      -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/[redacted-login]/g' \
      -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/[redacted-ip]/g' >&2
  exit 1
fi

echo "Tailscale accepted the rendered policy and its tests."
