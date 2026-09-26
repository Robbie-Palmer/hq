#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

query=$(</dev/stdin)
cloudflare_account_id=$(jq -er '.cloudflare_account_id' <<<"$query")
hyperdrive_name=$(jq -er '.hyperdrive_name' <<<"$query")
neon_database_name=$(jq -er '.neon_database_name' <<<"$query")
neon_org_id=$(jq -er '.neon_org_id' <<<"$query")
neon_project_name=$(jq -er '.neon_project_name' <<<"$query")
neon_role_name=$(jq -er '.neon_role_name' <<<"$query")
service_token_name=$(jq -er '.service_token_name' <<<"$query")

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${NEON_API_KEY:?NEON_API_KEY is required}"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-metadata.XXXXXX")"
chmod 700 "$work_dir"
cleanup() {
  find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'header = "Authorization: Bearer %s"\n' "$NEON_API_KEY" >"$work_dir/neon.curl"
printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" >"$work_dir/cloudflare.curl"

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
    response="$work_dir/branches-$page.json"
    request_args=(
      --disable
      --config "$work_dir/neon.curl"
      --connect-timeout 10
      --fail
      --max-time 30
      --silent
      --show-error
      --output "$response"
      --get
      --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches"
      --data-urlencode "limit=100"
    )
    if [[ -n "$cursor" ]]; then
      request_args+=(--data-urlencode "cursor=$cursor")
    fi

    curl "${request_args[@]}"
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

curl --disable --config "$work_dir/neon.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/projects.json" --get \
  --url "https://console.neon.tech/api/v2/projects" \
  --data-urlencode "org_id=$neon_org_id" \
  --data-urlencode "search=$neon_project_name" \
  --data-urlencode "limit=100"
project_count=$(jq --arg name "$neon_project_name" '[.projects[] | select(.name == $name)] | length' "$work_dir/projects.json")
if [[ "$project_count" -ne 1 ]]; then
  echo "Expected one exact Neon project named '$neon_project_name'; found $project_count." >&2
  exit 1
fi
neon_project_id=$(jq -er --arg name "$neon_project_name" '.projects[] | select(.name == $name) | .id' "$work_dir/projects.json")

if ! neon_branch_id=$(find_neon_branch_id); then
  echo "The Work Graph Neon project has no default or primary branch." >&2
  exit 1
fi

curl --disable --config "$work_dir/neon.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/endpoints.json" \
  --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches/$neon_branch_id/endpoints"
curl --disable --config "$work_dir/neon.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/databases.json" \
  --url "https://console.neon.tech/api/v2/projects/$neon_project_id/branches/$neon_branch_id/databases"
database_host=$(jq -er --arg branch_id "$neon_branch_id" \
  'first(.endpoints[] | select(.branch_id == $branch_id and .type == "read_write") | .host)' \
  "$work_dir/endpoints.json")
database_user=$(jq -er --arg database "$neon_database_name" \
  '.databases[] | select(.name == $database) | .owner_name' \
  "$work_dir/databases.json")
if [[ "$database_user" != "$neon_role_name" ]]; then
  echo "The Work Graph Neon database owner does not match '$neon_role_name'." >&2
  exit 1
fi

curl --disable --config "$work_dir/cloudflare.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/service-tokens.json" \
  --get \
  --url "https://api.cloudflare.com/client/v4/accounts/$cloudflare_account_id/access/service_tokens" \
  --data-urlencode "per_page=100"
if [[ "$(jq -er '.success' "$work_dir/service-tokens.json")" != true ]]; then
  echo "Cloudflare did not return the Access service-token inventory." >&2
  exit 1
fi
service_token_count=$(jq --arg name "$service_token_name" '[.result[] | select(.name == $name)] | length' "$work_dir/service-tokens.json")
if [[ "$service_token_count" -ne 1 ]]; then
  echo "Expected one exact Access service token named '$service_token_name'; found $service_token_count." >&2
  exit 1
fi
service_token_id=$(jq -er --arg name "$service_token_name" '.result[] | select(.name == $name) | .id' "$work_dir/service-tokens.json")

curl --disable --config "$work_dir/cloudflare.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/hyperdrives.json" \
  --url "https://api.cloudflare.com/client/v4/accounts/$cloudflare_account_id/hyperdrive/configs"
if [[ "$(jq -er '.success' "$work_dir/hyperdrives.json")" != true ]]; then
  echo "Cloudflare did not return the Hyperdrive inventory." >&2
  exit 1
fi
hyperdrive_count=$(jq --arg name "$hyperdrive_name" '[.result[] | select(.name == $name)] | length' "$work_dir/hyperdrives.json")
if [[ "$hyperdrive_count" -ne 1 ]]; then
  echo "Expected one exact Hyperdrive configuration named '$hyperdrive_name'; found $hyperdrive_count." >&2
  exit 1
fi
hyperdrive_id=$(jq -er --arg name "$hyperdrive_name" '.result[] | select(.name == $name) | .id' "$work_dir/hyperdrives.json")

jq -n \
  --arg database_host "$database_host" \
  --arg database_name "$neon_database_name" \
  --arg database_user "$database_user" \
  --arg hyperdrive_id "$hyperdrive_id" \
  --arg neon_branch_id "$neon_branch_id" \
  --arg neon_project_id "$neon_project_id" \
  --arg service_token_id "$service_token_id" \
  '{
    database_host: $database_host,
    database_name: $database_name,
    database_user: $database_user,
    hyperdrive_id: $hyperdrive_id,
    neon_branch_id: $neon_branch_id,
    neon_project_id: $neon_project_id,
    service_token_id: $service_token_id
  }'
