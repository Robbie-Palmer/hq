#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
source versions.env
images=(
  "$LOCALSTACK_IMAGE"
  "$ZOT_IMAGE"
  "$ZOT_PREVIOUS_IMAGE"
  "$DISTRIBUTION_IMAGE"
  "$DISTRIBUTION_PREVIOUS_IMAGE"
  "$HTTPD_IMAGE"
  "$CONFORMANCE_BUILDER_IMAGE"
)
for image in "${images[@]}"; do
  docker pull "$image"
done

