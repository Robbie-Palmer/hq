#!/usr/bin/env bash
set -euo pipefail

query_host=${POSTHOG_QUERY_HOST:-}
project_id=${POSTHOG_PROJECT_ID:-}
api_key=${POSTHOG_PERSONAL_API_KEY:-}

case "${query_host}" in
  https://eu.posthog.com|https://us.posthog.com) ;;
  *)
    echo "POSTHOG_QUERY_HOST must be the PostHog EU or US private API origin" >&2
    exit 2
    ;;
esac
if [[ ! ${project_id} =~ ^[0-9]+$ ]]; then
  echo "POSTHOG_PROJECT_ID must be numeric" >&2
  exit 2
fi
if [[ ! ${api_key} =~ ^phx_[A-Za-z0-9_-]+$ ]]; then
  echo "POSTHOG_PERSONAL_API_KEY is missing or malformed" >&2
  exit 2
fi

work_directory=$(mktemp -d)
cleanup() {
  rm -rf -- "${work_directory}"
}
trap cleanup EXIT

auth_config=${work_directory}/posthog.curl
umask 077
printf 'header = "Authorization: Bearer %s"\n' "${api_key}" >"${auth_config}"
unset api_key

run_hogql() {
  local query
  query=$(< /dev/stdin)
  if [[ -z ${query//[[:space:]]/} ]]; then
    echo "The HogQL query is empty" >&2
    exit 2
  fi
  jq -n --arg query "${query}" '{query: {kind: "HogQLQuery", query: $query}}' \
    >"${work_directory}/query.json"
  curl --fail --silent --show-error \
    --config "${auth_config}" \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary "@${work_directory}/query.json" \
    --url "${query_host}/api/projects/${project_id}/query/"
}

case "${1:-}" in
  homepage-vitals)
    run_hogql <<'HOGQL'
SELECT
    count() AS sample_count,
    round(quantile(0.75)(properties.$web_vitals_FCP_value)) AS p75_fcp_ms,
    round(quantile(0.75)(properties.$web_vitals_LCP_value)) AS p75_lcp_ms,
    round(quantile(0.75)(properties.$web_vitals_INP_value)) AS p75_inp_ms,
    round(quantile(0.75)(properties.$web_vitals_CLS_value), 3) AS p75_cls
FROM events
WHERE
    timestamp >= now() - INTERVAL 7 DAY
    AND replaceRegexpOne(properties.$current_url, '[?#].*$', '') IN (
        'https://robbiepalmer.me',
        'https://robbiepalmer.me/'
    )
    AND (
        properties.$web_vitals_FCP_value IS NOT NULL
        OR properties.$web_vitals_LCP_value IS NOT NULL
        OR properties.$web_vitals_INP_value IS NOT NULL
        OR properties.$web_vitals_CLS_value IS NOT NULL
    )
HOGQL
    ;;
  hogql)
    if [[ -t 0 ]]; then
      echo "Pass a HogQL query on standard input" >&2
      exit 2
    fi
    run_hogql
    ;;
  apm-services)
    curl --fail --silent --show-error \
      --config "${auth_config}" \
      --get \
      --data-urlencode 'date_from=-7d' \
      --url "${query_host}/api/projects/${project_id}/apm/services/"
    ;;
  *)
    echo "Usage: posthog-query {homepage-vitals|hogql|apm-services}" >&2
    exit 2
    ;;
esac
