#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
probe_root="$(mktemp -d)"
group_file="$probe_root/consumer-process-group"
started_file="$probe_root/child-started"
group_token="$(openssl rand -hex 16)"
wrapper_pid=""

cleanup() {
  if [[ -f "$group_file" ]]; then
    state=""
    process_group=""
    read -r state process_group _ < "$group_file" || true
    if [[ "$state" == "active" && "$process_group" =~ ^[1-9][0-9]*$ ]]; then
      kill -KILL -- "-$process_group" 2>/dev/null || true
    fi
  fi
  if [[ -n "$wrapper_pid" ]]; then
    kill -KILL "$wrapper_pid" 2>/dev/null || true
    wait "$wrapper_pid" 2>/dev/null || true
  fi
  rm -r "$probe_root"
}
trap cleanup EXIT

(
  umask 077
  printf 'launching %s %s\n' "$BASHPID" "$group_token" > "$group_file.next"
  mv "$group_file.next" "$group_file"
  HQ_R2_CONSUMER_GROUP_TOKEN="$group_token" \
    PROBE_GROUP_FILE="$group_file" \
    PROBE_STARTED_FILE="$started_file" \
    setsid --wait bash -c '
      : > "$PROBE_STARTED_FILE"
      sleep 0.5
      printf "active %s %s\n" "$$" "$HQ_R2_CONSUMER_GROUP_TOKEN" > "$PROBE_GROUP_FILE.next"
      mv "$PROBE_GROUP_FILE.next" "$PROBE_GROUP_FILE"
      exec sleep 30
    '
  consumer_status=$?
  exit "$consumer_status"
) &
wrapper_pid=$!

for _ in $(seq 1 50); do
  [[ -f "$started_file" ]] && break
  sleep 0.1
done
[[ -f "$started_file" ]]
kill -KILL "$wrapper_pid"
wait "$wrapper_pid" 2>/dev/null || true

CONSUMER_PROCESS_GROUP_FILE="$group_file" \
  bash "$project_root/scripts/stop-consumer-process-group.sh"
[[ ! -e "$group_file" ]]

group_token="$(openssl rand -hex 16)"
HQ_R2_CONSUMER_GROUP_TOKEN="$group_token" \
  PROBE_GROUP_FILE="$group_file" \
  setsid --wait bash -c '
    umask 077
    printf "active %s %s\n" "$$" "$HQ_R2_CONSUMER_GROUP_TOKEN" > "$PROBE_GROUP_FILE"
    exec sleep 30
  ' &
wrapper_pid=$!
for _ in $(seq 1 50); do
  [[ -f "$group_file" ]] && break
  sleep 0.1
done
[[ -f "$group_file" ]]

real_ps="$(command -v ps)"
fake_bin="$probe_root/fake-bin"
counter_file="$probe_root/ps-count"
mkdir "$fake_bin"
cat > "$fake_bin/ps" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ ! -f "$PS_COUNTER_FILE" ]] || read -r count < "$PS_COUNTER_FILE"
count=$((count + 1))
printf '%s\n' "$count" > "$PS_COUNTER_FILE"
if ((count >= 3)); then
  exit 1
fi
exec "$REAL_PS" "$@"
EOF
chmod +x "$fake_bin/ps"

set +e
PATH="$fake_bin:$PATH" REAL_PS="$real_ps" PS_COUNTER_FILE="$counter_file" \
  CONSUMER_PROCESS_GROUP_FILE="$group_file" \
  bash "$project_root/scripts/stop-consumer-process-group.sh" \
  2> "$probe_root/snapshot-failure.log"
cleanup_status=$?
set -e
[[ "$cleanup_status" -ne 0 ]]
[[ -f "$group_file" ]]
grep -Fq 'Could not inspect the R2 consumer process group' "$probe_root/snapshot-failure.log"

trap - EXIT
cleanup
