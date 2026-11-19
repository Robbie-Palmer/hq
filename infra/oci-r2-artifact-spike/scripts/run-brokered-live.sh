#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_root/.state"
command -v flock >/dev/null || {
  echo "flock is required to serialize live R2 evidence" >&2
  exit 2
}
exec 9> "$project_root/.state/live-run.lock"
flock 9

mise run //packages/object-storage:r2:broker -- run \
  --receipt "$project_root/.state/broker-receipt.json" \
  --helper "$project_root/scripts/r2-broker-s3.sh" \
  --bucket-prefix hq-oci-r2-canary \
  --ttl-seconds 1800 \
  -- bash "$project_root/scripts/run-timed-consumer.sh"

bash "$project_root/scripts/finalize-evidence.sh"
