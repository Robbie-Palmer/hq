#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

required_values=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  DOPPLER_CONFIG
  DOPPLER_PROJECT
  NEON_API_KEY
  NEON_DATABASE_NAME
  NEON_ORG_ID
  NEON_PG_VERSION
  NEON_PROJECT_NAME
  NEON_REGION
  NEON_ROLE_NAME
  WORK_GRAPH_API_ORIGIN
  WORK_GRAPH_DOPPLER_SERVICE_TOKEN
  WORK_GRAPH_HYPERDRIVE_NAME
  WORK_GRAPH_SERVICE_TOKEN_NAME
)

for name in "${required_values[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Cannot provision Work Graph credentials: $name is required." >&2
    exit 1
  fi
done

for command_name in curl jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Cannot provision Work Graph credentials: $command_name is required." >&2
    exit 1
  fi
done

if [[ ! "$NEON_PG_VERSION" =~ ^[0-9]+$ ]]; then
  echo "Cannot provision Work Graph credentials: NEON_PG_VERSION must be an integer." >&2
  exit 1
fi

secrets_root="${TMPDIR:-/tmp}"
if [[ -d /dev/shm && -w /dev/shm ]]; then
  secrets_root="/dev/shm"
fi
work_dir="$(mktemp -d "${secrets_root%/}/work-graph-credential-handoff.XXXXXX")"
chmod 700 "$work_dir"
created_access_token=false
created_hyperdrive=false
service_token_id=""
hyperdrive_id=""

cloudflare_response_succeeded() {
  local response_file="$1"
  jq -e '.success == true' "$response_file" >/dev/null
}

cleanup() {
  local exit_status="$?"
  if [[ "$created_access_token" == true && -n "$service_token_id" && -f "$work_dir/cloudflare.curl" ]]; then
    local delete_response="$work_dir/access-token-delete.json"
    if ! curl --disable --config "$work_dir/cloudflare.curl" --connect-timeout 10 --fail --max-time 30 \
      --silent --show-error --output "$delete_response" --request DELETE \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens/$service_token_id"; then
      echo "Could not remove the Access token whose Doppler write failed. Revoke it before retrying." >&2
    elif ! cloudflare_response_succeeded "$delete_response"; then
      echo "Could not remove the Access token whose Doppler write failed. Revoke it before retrying." >&2
    fi
  fi
  if [[ "$created_hyperdrive" == true && -n "$hyperdrive_id" && -f "$work_dir/cloudflare.curl" ]]; then
    local hyperdrive_delete_response="$work_dir/hyperdrive-delete.json"
    if ! curl --disable --config "$work_dir/cloudflare.curl" --connect-timeout 10 --fail --max-time 30 \
      --silent --show-error --output "$hyperdrive_delete_response" --request DELETE \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs/$hyperdrive_id"; then
      echo "Could not remove the Hyperdrive configuration whose Doppler write failed. Delete it before retrying." >&2
    elif ! cloudflare_response_succeeded "$hyperdrive_delete_response"; then
      echo "Could not remove the Hyperdrive configuration whose Doppler write failed. Delete it before retrying." >&2
    fi
  fi
  find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$work_dir" 2>/dev/null || true
  return "$exit_status"
}
trap cleanup EXIT INT TERM

write_bearer_config() {
  local path="$1"
  local token="$2"
  printf 'header = "Authorization: Bearer %s"\n' "$token" >"$path"
  chmod 600 "$path"
}

request_json() {
  local auth_config="$1"
  local output="$2"
  shift 2
  curl --disable \
    --config "$auth_config" \
    --connect-timeout 10 \
    --fail \
    --max-time 60 \
    --silent \
    --show-error \
    --output "$output" \
    "$@"
  chmod 600 "$output"
}

find_neon_branch_id() {
  local cursor=""
  local default_id=""
  local next_cursor=""
  local page=0
  local primary_id=""
  local response=""
  local -a request_args

  while true; do
    page=$((page + 1))
    response="$work_dir/neon-branches-$page.json"
    request_args=(
      --get
      --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches"
      --data-urlencode "limit=100"
    )
    if [[ -n "$cursor" ]]; then
      request_args+=(--data-urlencode "cursor=$cursor")
    fi

    request_json "$neon_auth" "$response" "${request_args[@]}" || return 1
    default_id=$(jq -r 'first(.branches[]? | select(.default == true) | .id) // empty' "$response")
    if [[ -n "$default_id" ]]; then
      printf '%s\n' "$default_id"
      return 0
    fi
    if [[ -z "$primary_id" ]]; then
      primary_id=$(jq -r 'first(.branches[]? | select(.primary == true) | .id) // empty' "$response")
    fi

    next_cursor=$(jq -r '.pagination.next // empty' "$response")
    if [[ -z "$next_cursor" ]]; then
      break
    fi
    if [[ "$next_cursor" == "$cursor" ]]; then
      echo "Neon returned a repeated branch-pagination cursor." >&2
      return 1
    fi
    cursor="$next_cursor"
  done

  if [[ -n "$primary_id" ]]; then
    printf '%s\n' "$primary_id"
    return 0
  fi
  return 1
}

neon_auth="$work_dir/neon.curl"
cloudflare_auth="$work_dir/cloudflare.curl"
doppler_auth="$work_dir/doppler.curl"
json_content_type="Content-Type: application/json"
write_bearer_config "$neon_auth" "$NEON_API_KEY"
write_bearer_config "$cloudflare_auth" "$CLOUDFLARE_API_TOKEN"
write_bearer_config "$doppler_auth" "$WORK_GRAPH_DOPPLER_SERVICE_TOKEN"

# Prove Doppler is writable before asking either provider for a one-time secret.
request_json "$doppler_auth" "$work_dir/doppler-preflight.json" \
  --get \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --data-urlencode "project=$DOPPLER_PROJECT" \
  --data-urlencode "config=$DOPPLER_CONFIG"
jq -n \
  --arg project "$DOPPLER_PROJECT" \
  --arg config "$DOPPLER_CONFIG" \
  --arg api_origin "$WORK_GRAPH_API_ORIGIN" \
  '{
    project: $project,
    config: $config,
    secrets: {
      WORK_GRAPH_API_URL: $api_origin,
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: $api_origin
    }
  }' \
  >"$work_dir/doppler-write-check.json"
request_json "$doppler_auth" "$work_dir/doppler-write-checked.json" \
  --request POST \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --header "$json_content_type" \
  --data-binary "@$work_dir/doppler-write-check.json"

request_json "$neon_auth" "$work_dir/neon-projects.json" \
  --get \
  --url "https://console.neon.tech/api/v2/projects" \
  --data-urlencode "org_id=$NEON_ORG_ID" \
  --data-urlencode "search=$NEON_PROJECT_NAME" \
  --data-urlencode "limit=100"

project_count=$(jq --arg name "$NEON_PROJECT_NAME" \
  '[.projects[] | select(.name == $name)] | length' \
  "$work_dir/neon-projects.json")

if [[ "$project_count" -gt 1 ]]; then
  echo "Cannot provision Work Graph: Neon returned more than one exact '$NEON_PROJECT_NAME' project." >&2
  exit 1
fi

if [[ "$project_count" -eq 0 ]]; then
  jq -n \
    --arg name "$NEON_PROJECT_NAME" \
    --arg org_id "$NEON_ORG_ID" \
    --arg region_id "$NEON_REGION" \
    --arg branch_name "main" \
    --arg database_name "$NEON_DATABASE_NAME" \
    --arg role_name "$NEON_ROLE_NAME" \
    --argjson pg_version "$NEON_PG_VERSION" \
    '{
      project: {
        name: $name,
        org_id: $org_id,
        region_id: $region_id,
        pg_version: $pg_version,
        history_retention_seconds: 21600,
        store_passwords: true,
        branch: {
          name: $branch_name,
          database_name: $database_name,
          role_name: $role_name
        }
      }
    }' >"$work_dir/neon-create.json"
  request_json "$neon_auth" "$work_dir/neon-created.json" \
    --request POST \
    --url "https://console.neon.tech/api/v2/projects" \
    --header "$json_content_type" \
    --data-binary "@$work_dir/neon-create.json"
  neon_project_id=$(jq -er '.project.id' "$work_dir/neon-created.json")
else
  neon_project_id=$(jq -er --arg name "$NEON_PROJECT_NAME" \
    '.projects[] | select(.name == $name) | .id' \
    "$work_dir/neon-projects.json")
fi

request_json "$neon_auth" "$work_dir/neon-project.json" \
  --url "https://console.neon.tech/api/v2/projects/$neon_project_id"

actual_region=$(jq -er '.project.region_id' "$work_dir/neon-project.json")
actual_pg_version=$(jq -er '.project.pg_version | tostring' "$work_dir/neon-project.json")
actual_retention=$(jq -er '.project.history_retention_seconds | tostring' "$work_dir/neon-project.json")
if [[ "$actual_region" != "$NEON_REGION" || "$actual_pg_version" != "$NEON_PG_VERSION" || "$actual_retention" != "21600" ]]; then
  echo "Cannot provision Work Graph: the existing Neon project does not match the declared region, PostgreSQL version, and retention." >&2
  exit 1
fi

metadata_ready=false
neon_branch_id=""
for attempt in 1 2 3 4 5; do
  neon_branch_id=$(find_neon_branch_id) || neon_branch_id=""
  if [[ -n "$neon_branch_id" ]] && \
    request_json "$neon_auth" "$work_dir/neon-endpoints.json" \
      --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches/$neon_branch_id/endpoints" && \
    request_json "$neon_auth" "$work_dir/neon-databases.json" \
      --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches/$neon_branch_id/databases"; then
    database_host=$(jq -er --arg branch_id "$neon_branch_id" \
      'first(.endpoints[] | select(.branch_id == $branch_id and .type == "read_write") | .host)' \
      "$work_dir/neon-endpoints.json")
    database_user=$(jq -er --arg database "$NEON_DATABASE_NAME" \
      '.databases[] | select(.name == $database) | .owner_name' \
      "$work_dir/neon-databases.json")
    if [[ -n "$database_host" && "$database_user" == "$NEON_ROLE_NAME" ]]; then
      metadata_ready=true
      break
    fi
  fi
  sleep "$attempt"
done

if [[ "$metadata_ready" != true ]]; then
  echo "Cannot provision Work Graph: the Neon branch, endpoint, or database did not become ready." >&2
  exit 1
fi

request_json "$neon_auth" "$work_dir/neon-password.json" \
  --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches/$neon_branch_id/roles/$database_user/reveal_password"
if ! jq -e '.password | type == "string" and length > 0' "$work_dir/neon-password.json" >/dev/null; then
  echo "Neon did not return the Work Graph database password." >&2
  exit 1
fi
jq -jrn \
  --arg database "$NEON_DATABASE_NAME" \
  --arg host "$database_host" \
  --arg user "$database_user" \
  --slurpfile credential "$work_dir/neon-password.json" \
  '($user | @uri) as $encoded_user
  | ($credential[0].password | @uri) as $encoded_password
  | ($database | @uri) as $encoded_database
  | "postgresql://\($encoded_user):\($encoded_password)@\($host):5432/\($encoded_database)?sslmode=require"' \
  >"$work_dir/database-url.txt"

request_json "$cloudflare_auth" "$work_dir/hyperdrives.json" \
  --get \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs"
if ! cloudflare_response_succeeded "$work_dir/hyperdrives.json"; then
  echo "Cloudflare did not return the Hyperdrive inventory." >&2
  exit 1
fi
hyperdrive_count=$(jq --arg name "$WORK_GRAPH_HYPERDRIVE_NAME" \
  '[.result[] | select(.name == $name)] | length' \
  "$work_dir/hyperdrives.json")
if [[ "$hyperdrive_count" -gt 1 ]]; then
  echo "Cannot provision Work Graph: Cloudflare returned more than one exact '$WORK_GRAPH_HYPERDRIVE_NAME' Hyperdrive configuration." >&2
  exit 1
fi

jq -n \
  --arg database "$NEON_DATABASE_NAME" \
  --arg host "$database_host" \
  --arg name "$WORK_GRAPH_HYPERDRIVE_NAME" \
  --arg user "$database_user" \
  --slurpfile credential "$work_dir/neon-password.json" \
  '{
    name: $name,
    origin: {
      database: $database,
      host: $host,
      port: 5432,
      user: $user,
      password: $credential[0].password,
      scheme: "postgresql"
    },
    caching: {disabled: true}
  }' >"$work_dir/hyperdrive-upsert.json"

if [[ "$hyperdrive_count" -eq 0 ]]; then
  request_json "$cloudflare_auth" "$work_dir/hyperdrive-created.json" \
    --request POST \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs" \
    --header "$json_content_type" \
    --data-binary "@$work_dir/hyperdrive-upsert.json"
  if ! cloudflare_response_succeeded "$work_dir/hyperdrive-created.json"; then
    echo "Cloudflare did not create the Work Graph Hyperdrive configuration." >&2
    exit 1
  fi
  hyperdrive_id=$(jq -er '.result.id' "$work_dir/hyperdrive-created.json")
  created_hyperdrive=true
else
  hyperdrive_id=$(jq -er --arg name "$WORK_GRAPH_HYPERDRIVE_NAME" \
    '.result[] | select(.name == $name) | .id' "$work_dir/hyperdrives.json")
  request_json "$cloudflare_auth" "$work_dir/hyperdrive-updated.json" \
    --request PUT \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs/$hyperdrive_id" \
    --header "$json_content_type" \
    --data-binary "@$work_dir/hyperdrive-upsert.json"
  if ! cloudflare_response_succeeded "$work_dir/hyperdrive-updated.json"; then
    echo "Cloudflare did not update the Work Graph Hyperdrive configuration." >&2
    exit 1
  fi
fi

request_json "$cloudflare_auth" "$work_dir/service-tokens.json" \
  --get \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens" \
  --data-urlencode "per_page=100"
if ! cloudflare_response_succeeded "$work_dir/service-tokens.json"; then
  echo "Cloudflare did not return the Access service-token inventory." >&2
  exit 1
fi
service_token_count=$(jq --arg name "$WORK_GRAPH_SERVICE_TOKEN_NAME" \
  '[.result[] | select(.name == $name)] | length' \
  "$work_dir/service-tokens.json")

if [[ "$service_token_count" -gt 1 ]]; then
  echo "Cannot provision Work Graph: Cloudflare returned more than one exact '$WORK_GRAPH_SERVICE_TOKEN_NAME' service token." >&2
  exit 1
fi

if [[ "$service_token_count" -eq 0 ]]; then
  jq -n --arg name "$WORK_GRAPH_SERVICE_TOKEN_NAME" \
    '{name: $name, duration: "forever"}' >"$work_dir/service-token-create.json"
  request_json "$cloudflare_auth" "$work_dir/service-token-created.json" \
    --request POST \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens" \
    --header "$json_content_type" \
    --data-binary "@$work_dir/service-token-create.json"
  if ! cloudflare_response_succeeded "$work_dir/service-token-created.json"; then
    echo "Cloudflare did not create the Work Graph Access service token." >&2
    exit 1
  fi
  service_token_id=$(jq -er '.result.id' "$work_dir/service-token-created.json")
  created_access_token=true
  jq -jre '.result.client_id | select(type == "string" and length > 0)' \
    "$work_dir/service-token-created.json" >"$work_dir/service-token-client-id.txt"
  jq -jre '.result.client_secret | select(type == "string" and length > 0)' \
    "$work_dir/service-token-created.json" >"$work_dir/service-token-secret.txt"
else
  service_token_id=$(jq -er --arg name "$WORK_GRAPH_SERVICE_TOKEN_NAME" \
    '.result[] | select(.name == $name) | .id' "$work_dir/service-tokens.json")
  jq -jre --arg name "$WORK_GRAPH_SERVICE_TOKEN_NAME" \
    '.result[] | select(.name == $name) | .client_id' \
    "$work_dir/service-tokens.json" >"$work_dir/service-token-client-id.txt"
  request_json "$doppler_auth" "$work_dir/doppler-existing.json" \
    --get \
    --url "https://api.doppler.com/v3/configs/config/secrets/download" \
    --data-urlencode "project=$DOPPLER_PROJECT" \
    --data-urlencode "config=$DOPPLER_CONFIG" \
    --data-urlencode "format=json" \
    --data-urlencode "secrets=CF_ACCESS_CLIENT_ID,CF_ACCESS_CLIENT_SECRET"
  if ! jq -e \
    --rawfile client_id "$work_dir/service-token-client-id.txt" \
    '.CF_ACCESS_CLIENT_ID == $client_id
      and (.CF_ACCESS_CLIENT_SECRET | type == "string" and length > 0)' \
      "$work_dir/doppler-existing.json" >/dev/null; then
    echo "Cannot provision Work Graph: the existing Access token has no matching credential pair in Doppler." >&2
    echo "Rotate that token into Doppler before retrying Terraform." >&2
    exit 1
  fi
  jq -jre '.CF_ACCESS_CLIENT_SECRET' "$work_dir/doppler-existing.json" \
    >"$work_dir/service-token-secret.txt"
fi

jq -n \
  --arg project "$DOPPLER_PROJECT" \
  --arg config "$DOPPLER_CONFIG" \
  --arg api_origin "$WORK_GRAPH_API_ORIGIN" \
  --arg hyperdrive_id "$hyperdrive_id" \
  --arg neon_project_id "$neon_project_id" \
  --arg service_token_id "$service_token_id" \
  --rawfile database_url "$work_dir/database-url.txt" \
  --rawfile client_id "$work_dir/service-token-client-id.txt" \
  --rawfile client_secret "$work_dir/service-token-secret.txt" \
  '{
    project: $project,
    config: $config,
    secrets: {
      DATABASE_URL: $database_url,
      WORK_GRAPH_HYPERDRIVE_ID: $hyperdrive_id,
      WORK_GRAPH_API_URL: $api_origin,
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: $api_origin,
      WORK_GRAPH_NEON_PROJECT_ID: $neon_project_id,
      WORK_GRAPH_CF_ACCESS_SERVICE_TOKEN_ID: $service_token_id,
      CF_ACCESS_CLIENT_ID: $client_id,
      CF_ACCESS_CLIENT_SECRET: $client_secret
    }
  }' >"$work_dir/doppler-update.json"
request_json "$doppler_auth" "$work_dir/doppler-updated.json" \
  --request POST \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --header "$json_content_type" \
  --data-binary "@$work_dir/doppler-update.json"

request_json "$doppler_auth" "$work_dir/doppler-verified.json" \
  --get \
  --url "https://api.doppler.com/v3/configs/config/secrets/download" \
  --data-urlencode "project=$DOPPLER_PROJECT" \
  --data-urlencode "config=$DOPPLER_CONFIG" \
  --data-urlencode "format=json" \
  --data-urlencode "secrets=DATABASE_URL,WORK_GRAPH_HYPERDRIVE_ID,CF_ACCESS_CLIENT_ID,CF_ACCESS_CLIENT_SECRET"
if ! jq -e \
  --arg hyperdrive_id "$hyperdrive_id" \
  --rawfile database_url "$work_dir/database-url.txt" \
  --rawfile client_id "$work_dir/service-token-client-id.txt" \
  --rawfile client_secret "$work_dir/service-token-secret.txt" \
  '.DATABASE_URL == $database_url
    and .WORK_GRAPH_HYPERDRIVE_ID == $hyperdrive_id
    and .CF_ACCESS_CLIENT_ID == $client_id
    and .CF_ACCESS_CLIENT_SECRET == $client_secret' \
  "$work_dir/doppler-verified.json" >/dev/null; then
  echo "Doppler did not return the Work Graph credentials after writing them." >&2
  exit 1
fi
created_access_token=false
created_hyperdrive=false

echo "Provisioned the Work Graph Neon project, Hyperdrive configuration, and Access service-token credential into Doppler."
