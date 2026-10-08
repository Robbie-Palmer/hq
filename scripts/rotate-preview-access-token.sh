#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
DOPPLER_SERVICE_TOKEN="${DOPPLER_SERVICE_TOKEN:-${WORK_GRAPH_DOPPLER_SERVICE_TOKEN:-}}"
: "${DOPPLER_SERVICE_TOKEN:?DOPPLER_SERVICE_TOKEN or WORK_GRAPH_DOPPLER_SERVICE_TOKEN is required}"

doppler_project="${DOPPLER_PROJECT:-personal-site}"
doppler_config="${DOPPLER_AGENT_CONFIG:-dev_agent}"
service_token_name="${CF_ACCESS_SERVICE_TOKEN_NAME:-personal-site-preview-qa-agents}"
recovery_guard_expires_at="2099-12-31T23:59:59Z"
rotation_guard_active=false

cleanup() {
  local exit_status="$?"
  unset client_secret rotation_response doppler_payload stored_credentials overlap_payload updated_service_tokens

  if [[ "$rotation_guard_active" == true ]]; then
    echo "Rotation did not finalize; the previously stored secret remains valid under the recovery guard." >&2
    echo "Do not rotate again until the guarded state has been inspected and repaired." >&2
  fi

  return "$exit_status"
}
trap cleanup EXIT

if date -u -d "+7 days" +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
  previous_secret_expires_at=$(date -u -d "+7 days" +"%Y-%m-%dT%H:%M:%SZ")
else
  previous_secret_expires_at=$(date -u -v+7d +"%Y-%m-%dT%H:%M:%SZ")
fi

if [[ ! "$previous_secret_expires_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "Could not calculate a valid RFC3339 overlap expiry." >&2
  exit 1
fi

# Prove the destination is writable before changing the Cloudflare secret.
curl \
  --disable \
  --connect-timeout 10 \
  --fail \
  --max-time 30 \
  --silent \
  --show-error \
  --output /dev/null \
  --get \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --header "Authorization: Bearer $DOPPLER_SERVICE_TOKEN" \
  --data-urlencode "project=$doppler_project" \
  --data-urlencode "config=$doppler_config"

service_tokens=$(curl \
  --disable \
  --connect-timeout 10 \
  --fail \
  --max-time 30 \
  --silent \
  --show-error \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN")

match_count=$(jq --arg name "$service_token_name" '[.result[] | select(.name == $name)] | length' <<<"$service_tokens")
if [[ "$match_count" -ne 1 ]]; then
  echo "Expected exactly one Cloudflare Access service token named '$service_token_name'; found $match_count." >&2
  exit 1
fi

service_token_id=$(jq -r --arg name "$service_token_name" '.result[] | select(.name == $name) | .id' <<<"$service_tokens")
existing_previous_secret_expires_at=$(jq -r \
  --arg name "$service_token_name" \
  '.result[] | select(.name == $name) | .previous_client_secret_expires_at // empty' \
  <<<"$service_tokens")

if [[ "$existing_previous_secret_expires_at" == 2099-12-31T23:59:59* ]]; then
  echo "Refusing to rotate over an unfinished recovery guard for '$service_token_name'." >&2
  echo "Inspect the Cloudflare token and Doppler credentials before clearing the guard." >&2
  exit 1
fi

rotation_payload=$(jq -nc \
  --arg recovery_guard_expires_at "$recovery_guard_expires_at" \
  '{previous_client_secret_expires_at: $recovery_guard_expires_at}')
rotation_response=$(printf '%s' "$rotation_payload" | curl \
  --disable \
  --connect-timeout 10 \
  --fail \
  --max-time 30 \
  --silent \
  --show-error \
  --request POST \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens/$service_token_id/rotate" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary @-)
rotation_guard_active=true

client_id=$(jq -er '.result.client_id' <<<"$rotation_response")
client_secret=$(jq -er '.result.client_secret' <<<"$rotation_response")

doppler_payload=$(printf '%s' "$client_secret" | jq -Rsc \
  --arg project "$doppler_project" \
  --arg config "$doppler_config" \
  --arg client_id "$client_id" \
  '{
    project: $project,
    config: $config,
    secrets: {
      CF_ACCESS_CLIENT_ID: $client_id,
      CF_ACCESS_CLIENT_SECRET: .
    }
  }')
printf '%s' "$doppler_payload" | curl \
  --disable \
  --connect-timeout 10 \
  --fail \
  --max-time 30 \
  --silent \
  --show-error \
  --output /dev/null \
  --request POST \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --header "Authorization: Bearer $DOPPLER_SERVICE_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary @-

credentials_verified=false
for attempt in 1 2 3; do
  if stored_credentials=$(curl \
    --disable \
    --connect-timeout 10 \
    --fail \
    --max-time 30 \
    --silent \
    --show-error \
    --get \
    --url "https://api.doppler.com/v3/configs/config/secrets/download" \
    --header "Authorization: Bearer $DOPPLER_SERVICE_TOKEN" \
    --data-urlencode "project=$doppler_project" \
    --data-urlencode "config=$doppler_config" \
    --data-urlencode "format=json" \
    --data-urlencode "secrets=CF_ACCESS_CLIENT_ID,CF_ACCESS_CLIENT_SECRET") && \
    [[ "$(jq -r '.CF_ACCESS_CLIENT_ID' <<<"$stored_credentials")" == "$client_id" ]] && \
    [[ "$(jq -r '.CF_ACCESS_CLIENT_SECRET' <<<"$stored_credentials")" == "$client_secret" ]]; then
    credentials_verified=true
    break
  fi

  if [[ "$attempt" -lt 3 ]]; then
    sleep "$attempt"
  fi
done

if [[ "$credentials_verified" != true ]]; then
  echo "Doppler did not return the newly rotated Access credentials." >&2
  exit 1
fi

overlap_payload=$(jq -nc \
  --arg previous_secret_expires_at "$previous_secret_expires_at" \
  '{previous_client_secret_expires_at: $previous_secret_expires_at}')
printf '%s' "$overlap_payload" | curl \
  --disable \
  --connect-timeout 10 \
  --fail \
  --max-time 30 \
  --silent \
  --show-error \
  --output /dev/null \
  --request PUT \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens/$service_token_id" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary @-
rotation_guard_active=false

overlap_verified=false
expected_overlap_prefix="${previous_secret_expires_at%Z}"
for attempt in 1 2 3; do
  if updated_service_tokens=$(curl \
    --disable \
    --connect-timeout 10 \
    --fail \
    --max-time 30 \
    --silent \
    --show-error \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens" \
    --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"); then
    actual_overlap=$(jq -r \
      --arg id "$service_token_id" \
      '.result[] | select(.id == $id) | .previous_client_secret_expires_at // empty' \
      <<<"$updated_service_tokens")
    if [[ "$actual_overlap" == "$expected_overlap_prefix"* ]]; then
      overlap_verified=true
      break
    fi
  fi

  if [[ "$attempt" -lt 3 ]]; then
    sleep "$attempt"
  fi
done

if [[ "$overlap_verified" != true ]]; then
  echo "Cloudflare did not return the finalized seven-day overlap." >&2
  exit 1
fi

unset client_secret rotation_response doppler_payload stored_credentials overlap_payload updated_service_tokens
echo "Rotated '$service_token_name' and updated $doppler_project/$doppler_config."
echo "The previous secret remains valid until $previous_secret_expires_at."
