#!/usr/bin/env bash
set -euo pipefail

source_project=${HEALTHCHECKS_SOURCE_PROJECT:-homelab}
source_config=${HEALTHCHECKS_SOURCE_CONFIG:-prd_remote_development_observability}
target_project=${DOPPLER_PERSONAL_ARCHIVE_PROJECT:-homelab}
target_config=${DOPPLER_PERSONAL_ARCHIVE_CONFIG:-prd_personal_archive_backup}
api_url=${HEALTHCHECKS_API_URL:-https://healthchecks.io/api/v3}
slack_integration_name=${HEALTHCHECKS_SLACK_INTEGRATION_NAME:-remote-development-alerts}
script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd -- "${script_directory}/.." && pwd)
default_inventory=${project_directory}/inventories/$(hostname -s | tr '[:upper:]' '[:lower:]').json
inventory=${1:-${PERSONAL_ARCHIVE_INVENTORY:-${default_inventory}}}

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [INVENTORY_FILE]" >&2
  exit 2
fi

for command in curl doppler hostname jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required" >&2; exit 1; }
done
[ -r "${inventory}" ] || { echo "personal archive inventory is not readable: ${inventory}" >&2; exit 1; }

check_name=$(jq -er '.monitoring.name' "${inventory}")
check_slug=$(jq -er '.monitoring.slug' "${inventory}")
check_tags=$(jq -er '.monitoring.tags' "${inventory}")
check_description=$(jq -er '.monitoring.description' "${inventory}")
check_timeout=$(jq -er '.monitoring.timeoutSeconds' "${inventory}")
check_grace=$(jq -er '.monitoring.graceSeconds' "${inventory}")

temporary_directory=$(mktemp -d)
header_file=${temporary_directory}/headers
channels_file=${temporary_directory}/channels.json
payload_file=${temporary_directory}/check.json
response_file=${temporary_directory}/response.json
cleanup() {
  unset api_key healthchecks_ping_url slack_integration_id
  if command -v shred >/dev/null 2>&1; then
    shred --remove "${header_file}" "${channels_file}" "${payload_file}" "${response_file}" 2>/dev/null || true
  fi
  rmdir "${temporary_directory}" 2>/dev/null || true
}
trap cleanup EXIT
umask 077

api_key=$(doppler secrets get HEALTHCHECKS_API_KEY \
  --project "${source_project}" --config "${source_config}" --plain)
[ -n "${api_key}" ] || { echo "HEALTHCHECKS_API_KEY is empty" >&2; exit 1; }
printf 'X-Api-Key: %s\n' "${api_key}" >"${header_file}"
unset api_key

api_url=${api_url%/}
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
  --header @"${header_file}" --output "${channels_file}" "${api_url}/channels/"
slack_integration_id=$(jq --exit-status --raw-output \
  --arg name "${slack_integration_name}" \
  '[.channels[] | select(.kind == "slack" and .name == $name)] |
    if length == 1 then .[0].id else error("expected one named Slack integration") end' \
  "${channels_file}")

jq --null-input --arg channel "${slack_integration_id}" \
  --arg name "${check_name}" --arg slug "${check_slug}" \
  --arg tags "${check_tags}" --arg description "${check_description}" \
  --argjson timeout "${check_timeout}" --argjson grace "${check_grace}" \
  '{name: $name, slug: $slug, tags: $tags, desc: $description,
    timeout: $timeout, grace: $grace, methods: "POST", channels: $channel,
    unique: ["slug"]}' >"${payload_file}"
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
  --request POST --header @"${header_file}" --header "Content-Type: application/json" \
  --data-binary @"${payload_file}" --output "${response_file}" "${api_url}/checks/"

jq --exit-status --arg channel "${slack_integration_id}" \
  --arg slug "${check_slug}" --argjson timeout "${check_timeout}" \
  --argjson grace "${check_grace}" \
  '.slug == $slug and .timeout == $timeout and
    .grace == $grace and .methods == "POST" and
    (.channels | split(",") | index($channel) != null)' "${response_file}" >/dev/null
healthchecks_ping_url=$(jq --exit-status --raw-output \
  '.ping_url | select(test("^https://hc-ping\\.com/[A-Za-z0-9_-]+/?$"))' \
  "${response_file}")
printf '%s' "${healthchecks_ping_url}" | doppler secrets set HEALTHCHECKS_PING_URL \
  --project "${target_project}" --config "${target_config}" \
  --visibility masked --silent

echo "reconciled ${check_slug} and stored its ping URL"
