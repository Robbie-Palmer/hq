#!/usr/bin/env bash
set -euo pipefail

if ! terraform show -json | jq -e '
  [
    .values.root_module.resources[]?
    | select(.type == "cloudflare_zero_trust_access_service_token")
    | .values.client_secret
  ]
  | all(. == null or . == "")
' >/dev/null; then
  echo "Cloudflare Access state contains a service-token secret." >&2
  exit 1
fi

echo "Cloudflare Access state contains no service-token secrets."
