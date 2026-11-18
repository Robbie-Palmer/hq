#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cleanup_complete=0

cleanup() {
  if [[ "$cleanup_complete" -eq 0 ]]; then
    if ! bash "$project_root/scripts/stop-consumer-process-group.sh"; then
      return 1
    fi
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

consumer_group_token="$(openssl rand -hex 16)"
set +e
HQ_R2_CONSUMER_GROUP_TOKEN="$consumer_group_token" \
  setsid --wait bash "$project_root/scripts/run-live-process-group.sh"
consumer_status=$?
set -e

if ! cleanup; then
  echo "Container cleanup could not be verified; blocking R2 bucket deletion" >&2
  exit 75
fi
trap - EXIT
exit "$consumer_status"
