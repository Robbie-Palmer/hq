#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cleanup_complete=0

cleanup() {
  if [[ "$cleanup_complete" -eq 0 ]]; then
    if ! bash "$project_root/scripts/stop-consumer-containers.sh"; then
      return 1
    fi
    cleanup_complete=1
  fi
}

cleanup_on_exit() {
  if ! cleanup; then
    echo "Container cleanup could not be verified; blocking R2 bucket deletion" >&2
    exit 75
  fi
}
trap cleanup_on_exit EXIT

set +e
timeout --kill-after=30s 25m bash "$project_root/scripts/run-live.sh"
consumer_status=$?
set -e

if ! cleanup; then
  echo "Container cleanup could not be verified; blocking R2 bucket deletion" >&2
  exit 75
fi
trap - EXIT
exit "$consumer_status"
