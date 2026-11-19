#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
group_file="${CONSUMER_PROCESS_GROUP_FILE:-$project_root/.state/consumer-process-group}"
group_token="${HQ_R2_CONSUMER_GROUP_TOKEN:?HQ_R2_CONSUMER_GROUP_TOKEN is required}"
if ! process_group="$(ps -o pgid= -p "$$" | tr -d ' ')"; then
  exit 74
fi

if [[ "$process_group" != "$$" ]]; then
  echo "The R2 consumer did not start as a process-group leader" >&2
  exit 75
fi

umask 077
printf 'active %s %s\n' "$process_group" "$group_token" > "$group_file.next"
mv "$group_file.next" "$group_file"
exec timeout --kill-after=30s 25m bash "$project_root/scripts/run-live.sh"
