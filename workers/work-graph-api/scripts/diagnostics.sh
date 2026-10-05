#!/usr/bin/env bash
set +x
set -euo pipefail
if [[ -z "${CLOUDFLARE_DIAGNOSTICS_API_TOKEN:-}" ]]; then
  if [[ "${WORK_GRAPH_DIAGNOSTICS_WRAPPED:-}" == 1 ]]; then
    echo 'CLOUDFLARE_DIAGNOSTICS_API_TOKEN is missing. Add the dedicated diagnostic token to Doppler.' >&2
    exit 2
  fi
  export WORK_GRAPH_DIAGNOSTICS_WRAPPED=1
  exec doppler run --project work-graph --config prd_work_graph \
    --preserve-env=WORK_GRAPH_DIAGNOSTICS_WRAPPED -- bash "$0" "$@"
fi
exec pnpm exec tsx scripts/diagnostics.ts "$@"
