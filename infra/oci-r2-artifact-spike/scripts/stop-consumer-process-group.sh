#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
group_file="${CONSUMER_PROCESS_GROUP_FILE:-$project_root/.state/consumer-process-group}"

[[ -f "$group_file" ]] || exit 0
read -r process_group group_token extra < "$group_file"
if [[ -n "${extra:-}" || ! "$process_group" =~ ^[1-9][0-9]*$ || ! "$group_token" =~ ^[a-f0-9]{32}$ ]]; then
  echo "The R2 consumer process-group record is invalid; refusing bucket recovery" >&2
  exit 1
fi

current_group="$(ps -o pgid= -p "$$" | tr -d ' ')"
if [[ "$process_group" == "$current_group" ]]; then
  echo "The cleanup process belongs to the recorded consumer group" >&2
  exit 1
fi

group_members() {
  ps -eo pid=,pgid= | awk -v group="$process_group" '$2 == group { print $1 }'
}

members="$(group_members)"
if [[ -z "$members" ]]; then
  rm "$group_file"
  exit 0
fi

for member in $members; do
  if [[ ! -r "/proc/$member/environ" ]] ||
    ! tr '\0' '\n' < "/proc/$member/environ" |
      grep -Fxq "HQ_R2_CONSUMER_GROUP_TOKEN=$group_token"; then
    if kill -0 "$member" 2>/dev/null; then
      echo "Process $member in the recorded group lacks the expected identity token" >&2
      exit 1
    fi
  fi
done

kill -TERM -- "-$process_group" 2>/dev/null || true
for _ in $(seq 1 50); do
  [[ -z "$(group_members)" ]] && break
  sleep 0.2
done
if [[ -n "$(group_members)" ]]; then
  kill -KILL -- "-$process_group" 2>/dev/null || true
  for _ in $(seq 1 50); do
    [[ -z "$(group_members)" ]] && break
    sleep 0.2
  done
fi
if [[ -n "$(group_members)" ]]; then
  echo "The R2 consumer process group remains active; refusing bucket recovery" >&2
  exit 1
fi

rm "$group_file"
