#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec mise run //packages/object-storage:r2:broker -- recover \
  --receipt "$project_root/.state/broker-receipt.json" \
  --helper "$project_root/scripts/r2-broker-s3.sh" \
  -- bash "$project_root/scripts/stop-consumer-resources.sh"
