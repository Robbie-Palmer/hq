#!/usr/bin/env bash
set -euo pipefail

max_tickets=${WORK_GRAPH_COORDINATOR_MAX_TICKETS:-3}
max_total_admissions=${WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS:-12}
max_launches_per_cycle=${WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE:-1}
poll_seconds=${WORK_GRAPH_COORDINATOR_POLL_SECONDS:-30}
relaunch_after_seconds=${WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS:-3600}
memory_usage_limit_percent=${WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT:-70}
memory_pressure_limit=${WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_LIMIT:-5}
io_pressure_limit=${WORK_GRAPH_COORDINATOR_IO_PRESSURE_LIMIT:-10}
memory_current_file=${WORK_GRAPH_COORDINATOR_MEMORY_CURRENT_FILE:-/sys/fs/cgroup/memory.current}
memory_max_file=${WORK_GRAPH_COORDINATOR_MEMORY_MAX_FILE:-/sys/fs/cgroup/memory.max}
memory_pressure_file=${WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_FILE:-/proc/pressure/memory}
io_pressure_file=${WORK_GRAPH_COORDINATOR_IO_PRESSURE_FILE:-/proc/pressure/io}
state_directory=${WORK_GRAPH_COORDINATOR_STATE_DIRECTORY:-/data/home/.t3/work-graph-coordinator}
project_checkout=${WORK_GRAPH_COORDINATOR_PROJECT_CHECKOUT:-/data/workspaces/personal-site}
run_once=${WORK_GRAPH_COORDINATOR_RUN_ONCE:-false}
skip_bootstrap=${WORK_GRAPH_COORDINATOR_SKIP_BOOTSTRAP:-false}
skip_provider_refresh=${WORK_GRAPH_COORDINATOR_SKIP_PROVIDER_REFRESH:-false}
exclude_documentation=${WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION:-true}
pod_uid=${WORK_GRAPH_COORDINATOR_POD_UID:-unknown}

require_positive_integer() {
  local name=$1
  local value=$2
  if [[ ! ${value} =~ ^[1-9][0-9]*$ ]]; then
    echo "${name} must be a positive integer" >&2
    exit 2
  fi
}

require_positive_integer WORK_GRAPH_COORDINATOR_MAX_TICKETS "${max_tickets}"
require_positive_integer WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS "${max_total_admissions}"
require_positive_integer WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE "${max_launches_per_cycle}"
require_positive_integer WORK_GRAPH_COORDINATOR_POLL_SECONDS "${poll_seconds}"
require_positive_integer WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS "${relaunch_after_seconds}"
require_positive_integer WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT "${memory_usage_limit_percent}"
require_positive_integer WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_LIMIT "${memory_pressure_limit}"
require_positive_integer WORK_GRAPH_COORDINATOR_IO_PRESSURE_LIMIT "${io_pressure_limit}"
if [ "${max_tickets}" -gt 100 ]; then
  echo "WORK_GRAPH_COORDINATOR_MAX_TICKETS must not exceed 100" >&2
  exit 2
fi
if [ "${max_total_admissions}" -gt 100 ]; then
  echo "WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS must not exceed 100" >&2
  exit 2
fi
if [ "${max_launches_per_cycle}" -gt "${max_tickets}" ]; then
  echo "WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE must not exceed the ticket limit" >&2
  exit 2
fi
if [ "${memory_usage_limit_percent}" -ge 100 ]; then
  echo "WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT must be less than 100" >&2
  exit 2
fi
if [ "${run_once}" != true ] && [ "${run_once}" != false ]; then
  echo "WORK_GRAPH_COORDINATOR_RUN_ONCE must be true or false" >&2
  exit 2
fi
if [ "${skip_bootstrap}" != true ] && [ "${skip_bootstrap}" != false ]; then
  echo "WORK_GRAPH_COORDINATOR_SKIP_BOOTSTRAP must be true or false" >&2
  exit 2
fi
if [ "${skip_provider_refresh}" != true ] && [ "${skip_provider_refresh}" != false ]; then
  echo "WORK_GRAPH_COORDINATOR_SKIP_PROVIDER_REFRESH must be true or false" >&2
  exit 2
fi
if [ "${exclude_documentation}" != true ] && [ "${exclude_documentation}" != false ]; then
  echo "WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION must be true or false" >&2
  exit 2
fi

mkdir -p "${state_directory}"
chmod 700 "${state_directory}"
state_file=${state_directory}/state.json
health_file=${state_directory}/health.json
process_file=${state_directory}/process

process_start_ticks() {
  local pid=$1
  awk '{ print $22 }' "/proc/${pid}/stat" 2>/dev/null || true
}

if [ -r "${process_file}" ]; then
  read -r previous_pod_uid previous_pid previous_start_ticks <"${process_file}" || true
  if [ "${previous_pod_uid:-}" = "${pod_uid}" ] \
    && [[ ${previous_pid:-} =~ ^[1-9][0-9]*$ ]] \
    && [[ ${previous_start_ticks:-} =~ ^[1-9][0-9]*$ ]] \
    && [ "$(process_start_ticks "${previous_pid}")" = "${previous_start_ticks}" ] \
    && [ "${previous_pid}" -ne "$$" ]; then
    kill -TERM -- "-${previous_pid}" 2>/dev/null \
      || kill -TERM "${previous_pid}" 2>/dev/null \
      || true
    for _ in $(seq 1 20); do
      if [ "$(process_start_ticks "${previous_pid}")" != "${previous_start_ticks}" ]; then
        break
      fi
      sleep 0.5
    done
    if [ "$(process_start_ticks "${previous_pid}")" = "${previous_start_ticks}" ]; then
      kill -KILL -- "-${previous_pid}" 2>/dev/null \
        || kill -KILL "${previous_pid}" 2>/dev/null \
        || true
    fi
  fi
fi

exec 9>"${state_directory}/coordinator.lock"
if ! flock --nonblock 9; then
  echo "another Work Graph agent coordinator holds the state lock" >&2
  exit 75
fi

current_start_ticks=$(process_start_ticks "$$")
test -n "${current_start_ticks}"
process_temporary=$(mktemp "${state_directory}/.process.XXXXXX")
printf '%s %s %s\n' "${pod_uid}" "$$" "${current_start_ticks}" >"${process_temporary}"
chmod 600 "${process_temporary}"
mv -- "${process_temporary}" "${process_file}"
cleanup_process_file() {
  local recorded_pod_uid recorded_pid recorded_start_ticks
  if [ -r "${process_file}" ]; then
    read -r recorded_pod_uid recorded_pid recorded_start_ticks <"${process_file}" || true
    if [ "${recorded_pod_uid:-}" = "${pod_uid}" ] \
      && [ "${recorded_pid:-}" = "$$" ] \
      && [ "${recorded_start_ticks:-}" = "${current_start_ticks}" ]; then
      rm -f -- "${process_file}"
    fi
  fi
}
trap cleanup_process_file EXIT
trap 'exit 0' INT TERM

find_main_worktree() {
  git -C "${project_checkout}" worktree list --porcelain \
    | awk '
        $1 == "worktree" { path = substr($0, length($1) + 2) }
        $1 == "branch" && $2 == "refs/heads/main" && main == "" { main = path }
        END { if (main != "") print main }
      '
}

worktree=${WORK_GRAPH_COORDINATOR_WORKTREE:-$(find_main_worktree)}
if [ -z "${worktree}" ] || [ ! -d "${worktree}" ]; then
  echo "the personal-site main worktree is unavailable" >&2
  exit 1
fi
cd "${worktree}"

for command in git jq mise pnpm t3; do
  if ! command -v "${command}" >/dev/null; then
    echo "${command} is required by the Work Graph agent coordinator" >&2
    exit 1
  fi
done

if [ "${skip_bootstrap}" = false ]; then
  mise run //:install
  if ! mise which work-graph >/dev/null 2>&1; then
    mise run //packages/work-graph-cli:install:global
  fi
fi

project_root=${WORK_GRAPH_COORDINATOR_PROJECT_ROOT:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}
base_branch=${T3_WORK_GRAPH_BASE_BRANCH:-}
if [ -z "${base_branch}" ]; then
  remote_head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
  base_branch=${remote_head#origin/}
fi
if [ -z "${base_branch}" ]; then
  base_branch=$(git config --get init.defaultBranch || true)
fi
base_branch=${base_branch:-main}
t3_home=${T3CODE_HOME:-/data/home/.t3}
t3_origin=${T3_WORK_GRAPH_ORIGIN:-$(jq -er '.origin' "${t3_home}/userdata/server-runtime.json")}

now_iso() {
  date --utc +%Y-%m-%dT%H:%M:%SZ
}

atomic_json() {
  local destination=$1
  local temporary
  temporary=$(mktemp "${state_directory}/.json.XXXXXX")
  cat >"${temporary}"
  chmod 600 "${temporary}"
  mv -- "${temporary}" "${destination}"
}

if [ ! -e "${state_file}" ]; then
  jq -n \
    --arg now "$(now_iso)" \
    --argjson max_tickets "${max_tickets}" \
    --argjson max_total_admissions "${max_total_admissions}" \
    '{
      schemaVersion: 2,
      maxTickets: $max_tickets,
      maxTotalAdmissions: $max_total_admissions,
      totalAdmissions: 0,
      createdAt: $now,
      updatedAt: $now,
      tickets: {}
    }' \
    | atomic_json "${state_file}"
fi

if jq -e '.schemaVersion == 1 and (.tickets | type == "object")' "${state_file}" >/dev/null; then
  migration_temporary=$(mktemp "${state_directory}/.state.XXXXXX")
  jq \
    --arg migrated_at "$(now_iso)" \
    --argjson max_total_admissions "${max_total_admissions}" \
    '.schemaVersion = 2
      | .maxTotalAdmissions = $max_total_admissions
      | .totalAdmissions = $max_total_admissions
      | .migratedAt = $migrated_at
      | .updatedAt = $migrated_at' \
    "${state_file}" >"${migration_temporary}"
  chmod 600 "${migration_temporary}"
  mv -- "${migration_temporary}" "${state_file}"
fi

jq -e '
  .schemaVersion == 2
    and (.tickets | type == "object")
    and (.totalAdmissions | type == "number")
    and .totalAdmissions >= 0
' "${state_file}" >/dev/null

update_state() {
  local temporary
  temporary=$(mktemp "${state_directory}/.state.XXXXXX")
  jq "$@" "${state_file}" >"${temporary}"
  chmod 600 "${temporary}"
  mv -- "${temporary}" "${state_file}"
}

pressure_full_avg10() {
  local file=$1
  awk '
      $1 == "full" {
        for (field = 2; field <= NF; field++) {
          split($field, pair, "=")
          if (pair[1] == "avg10") {
            print pair[2]
            exit
          }
        }
      }
    ' "${file}"
}

admission_open=false
admission_reason=not_checked
memory_usage_percent=0
memory_pressure_avg10=0
io_pressure_avg10=0

refresh_resource_admission() {
  local memory_current
  local memory_max

  admission_open=false
  admission_reason=telemetry_unavailable
  memory_usage_percent=0
  memory_pressure_avg10=0
  io_pressure_avg10=0

  if [ ! -r "${memory_current_file}" ] \
    || [ ! -r "${memory_max_file}" ] \
    || [ ! -r "${memory_pressure_file}" ] \
    || [ ! -r "${io_pressure_file}" ]; then
    return
  fi

  memory_current=$(tr -d '[:space:]' <"${memory_current_file}")
  memory_max=$(tr -d '[:space:]' <"${memory_max_file}")
  memory_pressure_avg10=$(pressure_full_avg10 "${memory_pressure_file}")
  io_pressure_avg10=$(pressure_full_avg10 "${io_pressure_file}")
  if [[ ! ${memory_current} =~ ^[0-9]+$ ]] \
    || [[ ! ${memory_max} =~ ^[1-9][0-9]*$ ]] \
    || [[ ! ${memory_pressure_avg10} =~ ^[0-9]+([.][0-9]+)?$ ]] \
    || [[ ! ${io_pressure_avg10} =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    return
  fi

  memory_usage_percent=$((memory_current * 100 / memory_max))
  if [ "${memory_usage_percent}" -ge "${memory_usage_limit_percent}" ]; then
    admission_reason=memory_usage
    return
  fi
  if awk -v value="${memory_pressure_avg10}" -v limit="${memory_pressure_limit}" \
    'BEGIN { exit !(value >= limit) }'; then
    admission_reason=memory_pressure
    return
  fi
  if awk -v value="${io_pressure_avg10}" -v limit="${io_pressure_limit}" \
    'BEGIN { exit !(value >= limit) }'; then
    admission_reason=io_pressure
    return
  fi

  admission_open=true
  admission_reason=open
}

work_graph() {
  mise exec -- work-graph "$@"
}

classify_documentation_ticket_ids() {
  local tickets=$1
  if [ "${exclude_documentation}" != true ]; then
    printf '[]\n'
    return
  fi
  T3_WORK_GRAPH_CLASSIFY_ONLY=true \
  T3_WORK_GRAPH_TICKETS="${tickets}" \
    mise exec -- pnpm exec tsx scripts/launch-work-graph-agent.ts \
    | jq -ec '.documentationTicketIds'
}

is_documentation_ticket_id() {
  local ticket_id=$1
  jq -e --arg ticket_id "${ticket_id}" 'index($ticket_id) != null' \
    <<<"${documentation_ticket_ids}" >/dev/null
}

total_admission_available() {
  local total_admissions
  total_admissions=$(jq -r '.totalAdmissions' "${state_file}")
  [ "${total_admissions}" -lt "${max_total_admissions}" ]
}

load_ticket_context() {
  local ticket_id=$1
  local context
  local attempt

  for attempt in 1 2 3; do
    if context=$(work_graph context show "${ticket_id}") \
      && [ -n "${context}" ] \
      && jq -e '.items | type == "array"' <<<"${context}" >/dev/null 2>&1; then
      printf '%s\n' "${context}"
      return 0
    fi
    echo "invalid Work Graph context for ${ticket_id} on attempt ${attempt}" >&2
    if [ "${attempt}" -lt 3 ]; then
      sleep 2
    fi
  done
  return 1
}

refresh_t3_providers() {
  local access_token=$1
  T3_ACCESS_TOKEN="${access_token}" \
  T3_ORIGIN="${t3_origin}" \
    mise exec -- node --input-type=module --eval '
      import { T3Client } from "@wyrd-company/t3code-client";
      const client = T3Client.create({
        accessToken: process.env.T3_ACCESS_TOKEN,
        baseUrl: process.env.T3_ORIGIN,
        clientLabel: "work-graph-agent-coordinator",
      });
      try {
        const result = await client.server.refreshProviders({ refreshModels: false });
        const ready = result.providers.some((provider) =>
          provider.driver === "codex"
            && provider.enabled
            && provider.installed
            && provider.status === "ready"
            && provider.auth.status === "authenticated"
            && provider.availability !== "unavailable"
        );
        if (!ready) throw new Error("no ready authenticated Codex provider");
      } finally {
        await client.close();
      }
    '
}

record_observation() {
  local ticket_id=$1
  local title=$2
  local stage=$3
  local observed_at=$4
  update_state \
    --arg ticket_id "${ticket_id}" \
    --arg title "${title}" \
    --arg stage "${stage}" \
    --arg observed_at "${observed_at}" \
    --argjson max_tickets "${max_tickets}" \
    --argjson max_total_admissions "${max_total_admissions}" \
    '.maxTickets = $max_tickets
      | .maxTotalAdmissions = $max_total_admissions
      | .updatedAt = $observed_at
      | .tickets[$ticket_id].title = $title
      | .tickets[$ticket_id].stage = $stage
      | .tickets[$ticket_id].lastObservedAt = $observed_at'
}

track_ticket() {
  local ticket_id=$1
  local title=$2
  local tracked_at=$3
  update_state \
    --arg ticket_id "${ticket_id}" \
    --arg title "${title}" \
    --arg tracked_at "${tracked_at}" \
    --argjson max_tickets "${max_tickets}" \
    --argjson max_total_admissions "${max_total_admissions}" \
    '.maxTickets = $max_tickets
      | .maxTotalAdmissions = $max_total_admissions
      | .totalAdmissions += 1
      | .updatedAt = $tracked_at
      | .tickets[$ticket_id] = {
          title: $title,
          stage: "ready",
          firstTrackedAt: $tracked_at,
          lastObservedAt: $tracked_at,
          lastLaunchAttemptAt: null,
          lastLaunchAt: null,
          threadId: null,
          lastError: null
        }'
}

forget_ticket() {
  local ticket_id=$1
  local updated_at=$2
  update_state \
    --arg ticket_id "${ticket_id}" \
    --arg updated_at "${updated_at}" \
    'del(.tickets[$ticket_id]) | .updatedAt = $updated_at'
}

launch_due() {
  local ticket_id=$1
  local last_attempt
  local last_attempt_epoch
  local current_epoch

  last_attempt=$(jq -r --arg ticket_id "${ticket_id}" '.tickets[$ticket_id].lastLaunchAttemptAt // empty' "${state_file}")
  if [ -z "${last_attempt}" ]; then
    return 0
  fi
  last_attempt_epoch=$(date --date="${last_attempt}" +%s 2>/dev/null || printf '0')
  current_epoch=$(date +%s)
  [ $((current_epoch - last_attempt_epoch)) -ge "${relaunch_after_seconds}" ]
}

launch_ticket() {
  local ticket_json=$1
  local ticket_id
  local title
  local context
  local selection
  local access_token
  local launch_output
  local thread_id
  local attempted_at
  local launched_at

  ticket_id=$(jq -er '.id' <<<"${ticket_json}")
  title=$(jq -er '.title' <<<"${ticket_json}")
  attempted_at=$(now_iso)
  update_state \
    --arg ticket_id "${ticket_id}" \
    --arg attempted_at "${attempted_at}" \
    '.updatedAt = $attempted_at
      | .tickets[$ticket_id].lastLaunchAttemptAt = $attempted_at
      | .tickets[$ticket_id].lastError = null'

  if ! context=$(load_ticket_context "${ticket_id}"); then
    update_state \
      --arg ticket_id "${ticket_id}" \
      --arg updated_at "$(now_iso)" \
      '.updatedAt = $updated_at
        | .tickets[$ticket_id].lastError = "context lookup failed"'
    echo "failed to load Work Graph context for ${ticket_id}" >&2
    return 1
  fi
  selection=$(jq -cn \
    --argjson ticket "${ticket_json}" \
    --argjson context "${context}" \
    '{ticket: $ticket, context: $context.items}')
  access_token=$(t3 auth session issue \
    --base-dir "${t3_home}" \
    --ttl 15m \
    --label work-graph-agent-coordinator \
    --token-only)

  if [ "${skip_provider_refresh}" = false ] \
    && ! refresh_t3_providers "${access_token}"; then
    update_state \
      --arg ticket_id "${ticket_id}" \
      --arg updated_at "$(now_iso)" \
      '.updatedAt = $updated_at
        | .tickets[$ticket_id].lastError = "provider refresh failed"'
    echo "failed to refresh T3 providers before launching ${ticket_id}" >&2
    return 1
  fi

  if ! launch_output=$(
    T3_ACCESS_TOKEN="${access_token}" \
    T3_WORK_GRAPH_BASE_BRANCH="${base_branch}" \
    T3_WORK_GRAPH_ORIGIN="${t3_origin}" \
    T3_WORK_GRAPH_PROJECT_ROOT="${project_root}" \
    T3_WORK_GRAPH_SELECTION="${selection}" \
      mise exec -- pnpm exec tsx scripts/launch-work-graph-agent.ts
  ); then
    update_state \
      --arg ticket_id "${ticket_id}" \
      --arg updated_at "$(now_iso)" \
      '.updatedAt = $updated_at
        | .tickets[$ticket_id].lastError = "agent launch failed"'
    echo "failed to launch a T3 thread for ${ticket_id}" >&2
    return 1
  fi

  thread_id=$(jq -er '.threadId' <<<"${launch_output}")
  launched_at=$(now_iso)
  update_state \
    --arg ticket_id "${ticket_id}" \
    --arg launched_at "${launched_at}" \
    --arg thread_id "${thread_id}" \
    '.updatedAt = $launched_at
      | .tickets[$ticket_id].lastLaunchAt = $launched_at
      | .tickets[$ticket_id].threadId = $thread_id
      | .tickets[$ticket_id].lastError = null'
  echo "launched ${ticket_id} in T3 thread ${thread_id}: ${title}"
}

write_health() {
  local reconciled_at=$1
  local excluded_documentation_count=$2
  local status=running
  local tracked_count
  local needs_attention_count
  local total_admissions
  local remaining_admissions
  tracked_count=$(jq '.tickets | length' "${state_file}")
  needs_attention_count=$(jq '[.tickets[] | select(.stage == "needs_attention")] | length' "${state_file}")
  total_admissions=$(jq '.totalAdmissions' "${state_file}")
  remaining_admissions=$((max_total_admissions - total_admissions))
  if [ "${remaining_admissions}" -lt 0 ]; then
    remaining_admissions=0
  fi
  if [ "${tracked_count}" -gt "${max_tickets}" ]; then
    status=draining
  elif [ "${remaining_admissions}" -eq 0 ]; then
    status=pilot_exhausted
  fi
  refresh_resource_admission
  if [ "${remaining_admissions}" -eq 0 ]; then
    admission_open=false
    admission_reason=pilot_exhausted
  fi
  jq -n \
    --arg status "${status}" \
    --arg reconciled_at "${reconciled_at}" \
    --arg admission_reason "${admission_reason}" \
    --argjson max_tickets "${max_tickets}" \
    --argjson max_total_admissions "${max_total_admissions}" \
    --argjson max_launches_per_cycle "${max_launches_per_cycle}" \
    --argjson tracked_count "${tracked_count}" \
    --argjson needs_attention_count "${needs_attention_count}" \
    --argjson total_admissions "${total_admissions}" \
    --argjson remaining_admissions "${remaining_admissions}" \
    --argjson excluded_documentation_count "${excluded_documentation_count}" \
    --argjson admission_open "${admission_open}" \
    --argjson memory_usage_percent "${memory_usage_percent}" \
    --argjson memory_pressure_avg10 "${memory_pressure_avg10}" \
    --argjson io_pressure_avg10 "${io_pressure_avg10}" \
    '{
      schemaVersion: 1,
      status: $status,
      reconciledAt: $reconciled_at,
      maxTickets: $max_tickets,
      maxTotalAdmissions: $max_total_admissions,
      maxLaunchesPerCycle: $max_launches_per_cycle,
      trackedCount: $tracked_count,
      needsAttentionCount: $needs_attention_count,
      totalAdmissions: $total_admissions,
      remainingAdmissions: $remaining_admissions,
      excludedDocumentationCount: $excluded_documentation_count,
      admission: {
        open: $admission_open,
        reason: $admission_reason,
        memoryUsagePercent: $memory_usage_percent,
        memoryPressureAvg10: $memory_pressure_avg10,
        ioPressureAvg10: $io_pressure_avg10
      }
    }' \
    | atomic_json "${health_file}"
}

reconcile() {
  local -a tracked_ids=()
  local reconciled_at
  local ticket_id
  local ticket_json
  local title
  local stage
  local tracked_count
  local queue
  local ready
  local documentation_ticket_ids
  local launch_attempts=0
  local launch_deferred_logged=false
  local excluded_documentation_count=0
  local pilot_exhaustion_logged=false

  launch_permitted() {
    if [ "${launch_attempts}" -ge "${max_launches_per_cycle}" ]; then
      if [ "${launch_deferred_logged}" = false ]; then
        echo "deferred further launches after reaching the per-cycle limit"
        launch_deferred_logged=true
      fi
      return 1
    fi
    refresh_resource_admission
    if [ "${admission_open}" != true ]; then
      if [ "${launch_deferred_logged}" = false ]; then
        echo "deferred launches because resource admission is ${admission_reason}"
        launch_deferred_logged=true
      fi
      return 1
    fi
    return 0
  }

  reconciled_at=$(now_iso)
  queue=$(work_graph queue --all --limit 100)
  jq -e '.items | type == "array"' <<<"${queue}" >/dev/null
  documentation_ticket_ids=$(classify_documentation_ticket_ids "$(jq -c '.items' <<<"${queue}")")
  mapfile -t tracked_ids < <(jq -r '.tickets | keys[]' "${state_file}")
  for ticket_id in "${tracked_ids[@]}"; do
    ticket_json=$(jq -c --arg ticket_id "${ticket_id}" \
      'first(.items[] | select(.id == $ticket_id)) // empty' \
      <<<"${queue}")
    if [ -z "${ticket_json}" ]; then
      ticket_json=$(work_graph show "${ticket_id}")
    fi
    title=$(jq -er '.title' <<<"${ticket_json}")
    stage=$(jq -er '.stage' <<<"${ticket_json}")
    case "${stage}" in
      released|cancelled)
        forget_ticket "${ticket_id}" "${reconciled_at}"
        echo "released coordinator slot for ${ticket_id} after ${stage}"
        ;;
      *)
        record_observation "${ticket_id}" "${title}" "${stage}" "${reconciled_at}"
        if is_documentation_ticket_id "${ticket_id}"; then
          excluded_documentation_count=$((excluded_documentation_count + 1))
          echo "did not relaunch documentation ticket ${ticket_id}: ${title}"
        elif { [ "${stage}" = ready ] || [ "${stage}" = stale ]; } \
          && launch_due "${ticket_id}" \
          && launch_permitted; then
          launch_attempts=$((launch_attempts + 1))
          launch_ticket "${ticket_json}" || true
        fi
        ;;
    esac
  done

  tracked_count=$(jq '.tickets | length' "${state_file}")
  if [ "${tracked_count}" -lt "${max_tickets}" ]; then
    ready=$(work_graph ready --limit 100)
    while IFS= read -r ticket_json; do
      ticket_id=$(jq -er '.id' <<<"${ticket_json}")
      if jq -e --arg ticket_id "${ticket_id}" '.tickets[$ticket_id] != null' "${state_file}" >/dev/null; then
        continue
      fi
      title=$(jq -er '.title' <<<"${ticket_json}")
      if is_documentation_ticket_id "${ticket_id}"; then
        excluded_documentation_count=$((excluded_documentation_count + 1))
        echo "excluded documentation ticket ${ticket_id}: ${title}"
        continue
      fi
      if ! total_admission_available; then
        if [ "${pilot_exhaustion_logged}" = false ]; then
          echo "deferred new tickets after exhausting the ${max_total_admissions}-ticket pilot budget"
          pilot_exhaustion_logged=true
        fi
        break
      fi
      if ! launch_permitted; then
        break
      fi
      track_ticket "${ticket_id}" "${title}" "${reconciled_at}"
      launch_attempts=$((launch_attempts + 1))
      launch_ticket "${ticket_json}" || true
      tracked_count=$(jq '.tickets | length' "${state_file}")
      if [ "${tracked_count}" -ge "${max_tickets}" ]; then
        break
      fi
    done < <(jq -c '.items[]' <<<"${ready}")
  fi

  write_health "$(now_iso)" "${excluded_documentation_count}"
}

while true; do
  reconcile
  if [ "${run_once}" = true ]; then
    break
  fi
  sleep "${poll_seconds}"
done
