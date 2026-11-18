#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

set +e
timeout --kill-after=30s 25m bash "$project_root/scripts/run-live.sh"
consumer_status=$?
set -e

if ! bash "$project_root/scripts/stop-consumer-containers.sh"; then
  echo "Container cleanup could not be verified; blocking R2 bucket deletion" >&2
  exit 75
fi
exit "$consumer_status"
