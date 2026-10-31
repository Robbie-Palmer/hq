#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
source versions.env
docker compose --env-file versions.env down --volumes --remove-orphans
docker image rm "$ZOT_RUNTIME_IMAGE" "$DISTRIBUTION_RUNTIME_IMAGE" >/dev/null 2>&1 || true
rm -rf .state

