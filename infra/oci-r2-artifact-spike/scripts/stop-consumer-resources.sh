#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$project_root/scripts/stop-consumer-process-group.sh"
bash "$project_root/scripts/stop-consumer-containers.sh"
