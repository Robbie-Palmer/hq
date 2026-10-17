#!/usr/bin/env bash
set -euo pipefail

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Cannot bootstrap the account-foundation workspace: $1 is required." >&2
    exit 1
  fi
}

require_command curl
require_command jq

: "${TFE_TOKEN:?TFE_TOKEN is required from the account-foundation seed config}"

organization="robbie-palmer"
workspace="personal-site-account-foundation"
api_url="https://app.terraform.io/api/v2"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

request() {
  local method="$1"
  local url="$2"
  shift 2

  curl \
    --silent \
    --show-error \
    --request "$method" \
    --header "Authorization: Bearer $TFE_TOKEN" \
    --header "Content-Type: application/vnd.api+json" \
    --output "$response_file" \
    --write-out "%{http_code}" \
    "$@" \
    "$url"
}

workspace_url="$api_url/organizations/$organization/workspaces/$workspace"
status="$(request GET "$workspace_url")"

if [[ "$status" == "404" ]]; then
  status="$(request POST "$api_url/organizations/$organization/workspaces" \
    --data '{"data":{"type":"workspaces","attributes":{"name":"personal-site-account-foundation","execution-mode":"local","auto-apply":false,"global-remote-state":false,"terraform-version":"1.16.4"}}}')"
  if [[ "$status" != "201" ]]; then
    echo "HCP Terraform rejected workspace creation with HTTP $status." >&2
    exit 1
  fi
  echo "Created the account-foundation HCP workspace in local execution mode."
elif [[ "$status" != "200" ]]; then
  echo "HCP Terraform workspace lookup failed with HTTP $status." >&2
  exit 1
else
  if ! jq -e '
    .data.attributes["execution-mode"] == "local" and
    .data.attributes["auto-apply"] == false and
    .data.attributes["global-remote-state"] == false
  ' "$response_file" >/dev/null; then
    echo "The existing account-foundation workspace does not match the protected seed settings." >&2
    echo "Review it through the human break-glass account; this task will not modify an existing workspace." >&2
    exit 1
  fi
  echo "Verified the existing account-foundation HCP workspace."
fi
