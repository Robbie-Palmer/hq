#!/usr/bin/env bash
set -euo pipefail

if ! terraform show -json | jq -e '
  def decoded_objects:
    select(type == "string" and length > 0)
    | (try fromjson catch {})
    | ..
    | objects;

  ([
    .values.root_module.resources[]?
    | select(.type == "cloudflare_zero_trust_access_service_token")
  ] | length == 0)
  and
  ([
    .values.root_module.resources[]?
    | select(.address | startswith("restapi_object.preview_service_token"))
  ] | length == 2)
  and
  ([
    .values.root_module.resources[]?
    | select(.address | startswith("restapi_object.preview_service_token"))
    | .values
    | [.api_response, .create_response][]?
    | decoded_objects
    | select(has("client_secret"))
    | .client_secret
  ] | all(. == null or . == ""))
' >/dev/null; then
  echo "Cloudflare Access state contains a service-token secret." >&2
  exit 1
fi

echo "Cloudflare Access state contains no service-token secrets."
