#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

if [[ "${WORK_GRAPH_DOPPLER_WRAPPED:-}" != "1" ]]; then
  missing=false
  for name in CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET WORK_GRAPH_API_URL; do
    if [[ -z "${!name:-}" ]]; then
      missing=true
    fi
  done
  if [[ "$missing" == true ]]; then
    if ! command -v doppler >/dev/null 2>&1; then
      echo "Cannot smoke-test Work Graph: required values are missing and doppler is unavailable." >&2
      exit 1
    fi
    export WORK_GRAPH_DOPPLER_WRAPPED=1
    exec doppler run \
      --project "${DOPPLER_PROJECT:-work-graph}" \
      --config "${DOPPLER_WORK_GRAPH_CONFIG:-prd_work_graph}" \
      --preserve-env=WORK_GRAPH_DOPPLER_WRAPPED,DOPPLER_PROJECT,DOPPLER_WORK_GRAPH_CONFIG \
      -- bash "$0"
  fi
fi

: "${CF_ACCESS_CLIENT_ID:?CF_ACCESS_CLIENT_ID is required}"
: "${CF_ACCESS_CLIENT_SECRET:?CF_ACCESS_CLIENT_SECRET is required}"
: "${WORK_GRAPH_API_URL:?WORK_GRAPH_API_URL is required}"
approved_origin="https://work-graph.robbiepalmer.me"
if [[ "$WORK_GRAPH_API_URL" != "$approved_origin" ]]; then
  echo "Cannot smoke-test Work Graph: WORK_GRAPH_API_URL is not the approved production origin." >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-smoke.XXXXXX")"
chmod 700 "$work_dir"
cleanup() {
  find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' \
  "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" >"$work_dir/access.curl"
curl_http_status_format='%{http_code}'
status="000"
healthy=false
for attempt in 1 2 3 4 5; do
  status=$(curl --disable \
    --config "$work_dir/access.curl" \
    --connect-timeout 10 \
    --max-time 30 \
    --silent \
    --show-error \
    --output "$work_dir/response.json" \
    --write-out "$curl_http_status_format" \
    "$WORK_GRAPH_API_URL/api/work-items?limit=1") || status="000"
  if [[ "$status" == "200" ]] && jq -e '.items | type == "array"' "$work_dir/response.json" >/dev/null; then
    healthy=true
    break
  fi
  sleep "$attempt"
done

if [[ "$healthy" != true ]]; then
  echo "Work Graph production smoke test failed with HTTP $status." >&2
  exit 1
fi

status=$(curl --disable \
  --config "$work_dir/access.curl" \
  --connect-timeout 10 \
  --max-time 30 \
  --silent \
  --show-error \
  --output "$work_dir/unscoped.json" \
  --write-out "$curl_http_status_format" \
  "$WORK_GRAPH_API_URL/api/work-items?limit=100")
if [[ "$status" != "200" ]]; then
  echo "Work Graph production unscoped queue check failed with HTTP $status." >&2
  exit 1
fi
unscoped_id=$(jq -r \
  '.items | map(select(.id != "work-graph-finish-mvp" and .schedulingProjectId == null)) | first | .id // empty' \
  "$work_dir/unscoped.json")
if [[ -z "$unscoped_id" ]]; then
  echo "Work Graph production smoke test could not find an unscoped comparison ticket." >&2
  exit 1
fi

status=$(curl --disable \
  --config "$work_dir/access.curl" \
  --connect-timeout 10 \
  --max-time 30 \
  --silent \
  --show-error \
  --request PUT \
  --header "Content-Type: application/json" \
  --data '{"schedulingInitiativeId":"semi-autonomous-software-development","schedulingProjectId":"work-graph"}' \
  --output "$work_dir/assignment.json" \
  --write-out "$curl_http_status_format" \
  "$WORK_GRAPH_API_URL/api/work-items/work-graph-finish-mvp/scheduling-scope")
if [[ "$status" != "200" ]] || ! jq -e \
  '.id == "work-graph-finish-mvp" and .schedulingInitiativeId == "semi-autonomous-software-development" and .schedulingProjectId == "work-graph"' \
  "$work_dir/assignment.json" >/dev/null; then
  echo "Work Graph production plan assignment failed with HTTP $status." >&2
  exit 1
fi

status=$(curl --disable \
  --config "$work_dir/access.curl" \
  --connect-timeout 10 \
  --max-time 30 \
  --silent \
  --show-error \
  --output "$work_dir/scoped.json" \
  --write-out "$curl_http_status_format" \
  "$WORK_GRAPH_API_URL/api/work-items?projectId=work-graph&limit=100")
if [[ "$status" != "200" ]] || ! jq -e \
  --arg unscoped_id "$unscoped_id" \
  '(.items | any(.id == "work-graph-finish-mvp")) and (.items | all(.schedulingProjectId == "work-graph")) and (.items | all(.id != $unscoped_id))' \
  "$work_dir/scoped.json" >/dev/null; then
  echo "Work Graph production scoped queue verification failed with HTTP $status." >&2
  exit 1
fi

echo "Work Graph production queue and Work Graph project scope are healthy."
