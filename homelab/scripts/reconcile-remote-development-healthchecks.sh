#!/usr/bin/env bash
set -euo pipefail

doppler_project=${DOPPLER_REMOTE_DEVELOPMENT_OBSERVABILITY_PROJECT:-homelab}
doppler_config=${DOPPLER_REMOTE_DEVELOPMENT_OBSERVABILITY_CONFIG:-prd_remote_development_observability}
api_url=${HEALTHCHECKS_API_URL:-https://healthchecks.io/api/v3}
slack_integration_name=${HEALTHCHECKS_SLACK_INTEGRATION_NAME:-remote-development-alerts}

for command in curl doppler jq; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required to reconcile the Healthchecks.io check" >&2
    exit 1
  fi
done

temporary_directory=$(mktemp -d)
header_file=${temporary_directory}/headers
channels_file=${temporary_directory}/channels.json
payload_file=${temporary_directory}/check.json
response_file=${temporary_directory}/response.json
cleanup() {
  unset api_key healthchecks_ping_url slack_integration_id
  if command -v shred >/dev/null 2>&1; then
    shred --remove "${header_file}" "${channels_file}" "${payload_file}" "${response_file}" 2>/dev/null || true
  else
    rm -f -- "${header_file}" "${channels_file}" "${payload_file}" "${response_file}"
  fi
  rmdir "${temporary_directory}" 2>/dev/null || true
}
trap cleanup EXIT
umask 077

api_key=$(
  doppler secrets get HEALTHCHECKS_API_KEY \
    --project "${doppler_project}" \
    --config "${doppler_config}" \
    --plain
)
if [ -z "${api_key}" ]; then
  echo "HEALTHCHECKS_API_KEY is empty" >&2
  exit 1
fi
printf 'X-Api-Key: %s\n' "${api_key}" >"${header_file}"
unset api_key

api_url=${api_url%/}
curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  --header @"${header_file}" \
  --output "${channels_file}" \
  "${api_url}/channels/"

slack_integration_id=$(
  jq \
    --exit-status \
    --raw-output \
    --arg name "${slack_integration_name}" \
    '
      [.channels[] | select(.kind == "slack" and .name == $name)]
      | if length == 1 then
          .[0].id
        else
          error("expected exactly one Slack integration named \($name)")
        end
    ' \
    "${channels_file}"
)

jq \
  --null-input \
  --arg channel "${slack_integration_id}" \
  '{
    name: "remote-development host",
    slug: "remote-development-host",
    tags: "remote-development host-loss",
    desc: "External reachability check for the remote-development host",
    timeout: 60,
    grace: 120,
    methods: "POST",
    channels: $channel,
    unique: ["slug"]
  }' >"${payload_file}"

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  --request POST \
  --header @"${header_file}" \
  --header "Content-Type: application/json" \
  --data-binary @"${payload_file}" \
  --output "${response_file}" \
  "${api_url}/checks/"

jq \
  --exit-status \
  --arg channel "${slack_integration_id}" \
  '
    .slug == "remote-development-host"
    and .timeout == 60
    and .grace == 120
    and .methods == "POST"
    and (.channels | split(",") | index($channel) != null)
  ' \
  "${response_file}" >/dev/null

healthchecks_ping_url=$(
  jq \
    --exit-status \
    --raw-output \
    '.ping_url | select(test("^https://hc-ping\\.com/[A-Za-z0-9_-]+/?$"))' \
    "${response_file}"
)
printf '%s' "${healthchecks_ping_url}" \
  | doppler secrets set HEALTHCHECKS_PING_URL \
    --project "${doppler_project}" \
    --config "${doppler_config}" \
    --visibility masked \
    --silent

echo "reconciled Healthchecks.io check remote-development-host and stored its ping URL in Doppler"
