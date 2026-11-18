#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mise run //packages/object-storage:r2:broker -- run \
  --receipt "$project_root/.state/broker-receipt.json" \
  --helper "$project_root/scripts/r2-broker-s3.sh" \
  --bucket-prefix hq-oci-r2-canary \
  --ttl-seconds 1800 \
  -- timeout --kill-after=30s 25m bash "$project_root/scripts/run-live.sh"

bash "$project_root/scripts/finalize-evidence.sh"
