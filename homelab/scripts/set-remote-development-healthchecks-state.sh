#!/usr/bin/env bash
set -euo pipefail

desired_state=${1:-}
case "${desired_state}" in
  pause | resume) ;;
  *)
    echo "usage: $0 pause|resume" >&2
    exit 2
    ;;
esac

doppler_project=${DOPPLER_REMOTE_DEVELOPMENT_OBSERVABILITY_PROJECT:-homelab}
doppler_config=${DOPPLER_REMOTE_DEVELOPMENT_OBSERVABILITY_CONFIG:-prd_remote_development_observability}
api_url=${HEALTHCHECKS_API_URL:-https://healthchecks.io/api/v3}
check_slug=${HEALTHCHECKS_CHECK_SLUG:-remote-development-host}

for command in curl doppler jq; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required to change the Healthchecks.io check state" >&2
    exit 1
  fi
done

temporary_directory=$(mktemp -d)
header_file=${temporary_directory}/headers
checks_file=${temporary_directory}/checks.json
check_file=${temporary_directory}/check.json
cleanup() {
  unset api_key check_uuid check_status
  if command -v shred >/dev/null 2>&1; then
    shred --remove "${header_file}" "${checks_file}" "${check_file}" 2>/dev/null || true
  else
    rm -f -- "${header_file}" "${checks_file}" "${check_file}"
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
if [[ -z "${api_key}" ]]; then
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
  --output "${checks_file}" \
  "${api_url}/checks/"

read -r check_uuid check_status < <(
  jq \
    --exit-status \
    --raw-output \
    --arg slug "${check_slug}" \
    '
      [.checks[] | select(.slug == $slug)]
      | if length == 1
          and (.[0].uuid | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
          and ((.[0].status) as $status | ["new", "up", "grace", "down", "paused"] | index($status) != null)
        then
          "\(.[0].uuid) \(.[0].status)"
        else
          error("expected exactly one writable check with slug \($slug)")
        end
    ' \
    "${checks_file}"
)

if [[ "${desired_state}" = pause ]] && [[ "${check_status}" = paused ]]; then
  echo "Healthchecks.io check ${check_slug} is already paused"
  exit 0
fi
if [[ "${desired_state}" = resume ]] && [[ "${check_status}" != paused ]]; then
  echo "Healthchecks.io check ${check_slug} is already active"
  exit 0
fi

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  --request POST \
  --header @"${header_file}" \
  --data "" \
  --output /dev/null \
  "${api_url}/checks/${check_uuid}/${desired_state}"

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  --header @"${header_file}" \
  --output "${check_file}" \
  "${api_url}/checks/${check_uuid}"

if [[ "${desired_state}" = pause ]]; then
  expected_status=paused
else
  expected_status=new
fi
jq \
  --exit-status \
  --arg slug "${check_slug}" \
  --arg status "${expected_status}" \
  '.slug == $slug and .status == $status' \
  "${check_file}" >/dev/null

echo "Healthchecks.io check ${check_slug} is ${expected_status}"
