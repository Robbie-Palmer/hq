#!/usr/bin/env bash
set -euo pipefail
set +x

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_R2_AUDIT_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_R2_AUDIT_API_TOKEN are required." >&2
  exit 2
fi

buckets=("$@")
if ((${#buckets[@]} == 0)); then
  buckets=(work-graph-private-analytics work-graph-private-analytics-models)
fi

for bucket in "${buckets[@]}"; do
  managed="$(curl --fail --silent --show-error --max-time 15 \
    --header "Authorization: Bearer ${CLOUDFLARE_R2_AUDIT_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${bucket}/domains/managed")"
  custom="$(curl --fail --silent --show-error --max-time 15 \
    --header "Authorization: Bearer ${CLOUDFLARE_R2_AUDIT_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom")"
  if ! jq -e '.success == true and .result.enabled == false' \
    <<<"$managed" >/dev/null; then
    echo "Managed public R2 access is enabled or could not be verified for ${bucket}." >&2
    exit 1
  fi
  if ! jq -e '.success == true and (.result.domains | all(.enabled == false))' \
    <<<"$custom" >/dev/null; then
    echo "A custom public R2 domain is enabled or could not be verified for ${bucket}." >&2
    exit 1
  fi
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 15 \
    "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/")"
  if [[ "$status" != 400 && "$status" != 401 && "$status" != 403 ]]; then
    echo "Anonymous R2 access did not fail closed for ${bucket}; HTTP ${status}." >&2
    exit 1
  fi
  echo "Public R2 domains are disabled and anonymous S3 access is denied for ${bucket}."
done
