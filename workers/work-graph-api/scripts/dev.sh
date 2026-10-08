#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORK_GRAPH_DOPPLER_WRAPPED:-}" != "1" && ! -f .dev.vars ]]; then
  if ! command -v doppler >/dev/null 2>&1; then
    echo "Cannot start Work Graph locally: doppler is required when .dev.vars is absent." >&2
    exit 1
  fi
  export WORK_GRAPH_DOPPLER_WRAPPED=1
  exec doppler run \
    --project "${DOPPLER_PROJECT:-work-graph}" \
    --config "${DOPPLER_WORK_GRAPH_CONFIG:-dev_work_graph}" \
    --preserve-env=WORK_GRAPH_DOPPLER_WRAPPED,DOPPLER_PROJECT,DOPPLER_WORK_GRAPH_CONFIG \
    -- bash "$0" "$@"
fi

if [[ -z "${CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:-}" && -n "${DATABASE_URL:-}" ]]; then
  export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL"
fi

exec wrangler dev "$@"
