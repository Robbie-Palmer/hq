#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
group_file="${CONSUMER_PROCESS_GROUP_FILE:-$project_root/.state/consumer-process-group}"

[[ -f "$group_file" ]] || exit 0
read_record() {
  group_state=""
  process_group=""
  group_token=""
  extra=""
  read -r group_state process_group group_token extra < "$group_file"
}

read_record
if [[ -n "${extra:-}" || ! "$group_token" =~ ^[a-f0-9]{32}$ ]] ||
  [[ "$group_state" != "launching" && "$group_state" != "active" ]] ||
  [[ ! "$process_group" =~ ^[1-9][0-9]*$ ]]; then
  echo "The R2 consumer process-group record is invalid; refusing bucket recovery" >&2
  exit 1
fi

if [[ "$group_state" == "launching" ]]; then
  launch_process="$process_group"
  launch_token="$group_token"
  for _ in $(seq 1 50); do
    sleep 0.1
    read_record
    if [[ "$group_state" == "active" && "$group_token" == "$launch_token" ]]; then
      break
    fi
    if [[ "$group_state" != "launching" || "$process_group" != "$launch_process" ||
      "$group_token" != "$launch_token" || -n "${extra:-}" ]]; then
      echo "The R2 consumer launch record changed unexpectedly; refusing bucket recovery" >&2
      exit 1
    fi
  done
fi
if [[ "$group_state" != "active" || ! "$process_group" =~ ^[1-9][0-9]*$ ]]; then
  echo "The R2 consumer group was not published; refusing bucket recovery" >&2
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
