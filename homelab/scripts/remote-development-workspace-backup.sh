#!/usr/bin/env bash
set -euo pipefail

config_file=${WORKSPACE_BACKUP_CONFIG:-/etc/remote-development-workspace-backup/config}
restic_bin=${RESTIC_BIN:-restic}
state_export_bin=${WORKSPACE_STATE_EXPORT_BIN:-remote-development-workspace-state-export}

if [ ! -r "${config_file}" ]; then
  echo "workspace backup configuration is not readable" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${config_file}"

for name in WORKSPACE_ID BACKUP_SOURCE BACKUP_STAGING_DIRECTORY \
  BACKUP_EXCLUDES_FILE BACKUP_STATUS_FILE BACKUP_PASSWORD_FILE \
  CHECK_READ_DATA_SUBSET KEEP_WITHIN KEEP_LAST; do
  if [ -z "${!name:-}" ]; then
    echo "workspace backup configuration is missing ${name}" >&2
    exit 1
  fi
done

if [ ! -d "${BACKUP_SOURCE}" ]; then
  echo "workspace backup source is not a directory" >&2
  exit 1
fi
if [ ! -r "${BACKUP_EXCLUDES_FILE}" ]; then
  echo "workspace backup exclude file is not readable" >&2
  exit 1
fi
if [ ! -r "${BACKUP_PASSWORD_FILE}" ]; then
  echo "workspace backup password file is not readable" >&2
  exit 1
fi
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  echo "RESTIC_REPOSITORY is not set" >&2
  exit 1
fi
export RESTIC_PASSWORD_FILE="${BACKUP_PASSWORD_FILE}"

status_directory=$(dirname -- "${BACKUP_STATUS_FILE}")
install -d -m 0700 "${status_directory}"
case "${BACKUP_STAGING_DIRECTORY}" in
  "${status_directory}"/*) ;;
  *)
    echo "workspace backup staging directory must be below the status directory" >&2
    exit 1
    ;;
esac
exec 9>"${status_directory}/backup.lock"
if ! flock -n 9; then
  echo "another workspace backup is running" >&2
  exit 1
fi
work_directory=$(mktemp -d "${status_directory}/run.XXXXXX")
chmod 0700 "${work_directory}"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
started_unix=$(date +%s)
step=initialization
last_success_at=null
last_success_unix=null

cleanup() {
  rm -rf -- "${BACKUP_STAGING_DIRECTORY}"
  rm -rf -- "${work_directory}"
}
trap cleanup EXIT

if [ -r "${BACKUP_STATUS_FILE}" ]; then
  last_success_at=$(jq -r '.lastSuccessAt // "null"' "${BACKUP_STATUS_FILE}" 2>/dev/null || printf 'null')
  last_success_unix=$(jq -r '.lastSuccessUnix // "null"' "${BACKUP_STATUS_FILE}" 2>/dev/null || printf 'null')
fi

write_status() {
  local state=$1
  local exit_code=$2
  local completed_at completed_unix temporary_status
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  completed_unix=$(date +%s)
  temporary_status="${work_directory}/status.json"

  if [ "${state}" = success ]; then
    last_success_at=${completed_at}
    last_success_unix=${completed_unix}
  fi

  jq --null-input \
    --arg workspaceId "${WORKSPACE_ID}" \
    --arg destinationProvider "${DESTINATION_PROVIDER}" \
    --arg state "${state}" \
    --arg failedStep "${step}" \
    --arg startedAt "${started_at}" \
    --arg completedAt "${completed_at}" \
    --arg lastSuccessAt "${last_success_at}" \
    --argjson startedUnix "${started_unix}" \
    --argjson completedUnix "${completed_unix}" \
    --argjson lastSuccessUnix "${last_success_unix}" \
    --argjson exitCode "${exit_code}" \
    '{
      schemaVersion: 1,
      workspaceId: $workspaceId,
      destinationProvider: $destinationProvider,
      state: $state,
      failedStep: (if $state == "success" then null else $failedStep end),
      exitCode: $exitCode,
      startedAt: $startedAt,
      startedUnix: $startedUnix,
      completedAt: $completedAt,
      completedUnix: $completedUnix,
      lastSuccessAt: (if $lastSuccessAt == "null" then null else $lastSuccessAt end),
      lastSuccessUnix: $lastSuccessUnix
    }' >"${temporary_status}"
  chmod 0600 "${temporary_status}"
  mv -f -- "${temporary_status}" "${BACKUP_STATUS_FILE}"
}

run_restic() {
  local log_file=$1
  shift
  set +e
  "${restic_bin}" "$@" >"${log_file}" 2>&1
  local command_status=$?
  set -e
  return "${command_status}"
}

if run_restic "${work_directory}/repository.log" snapshots --latest 1 --json; then
  :
else
  step=initialize
  if run_restic "${work_directory}/initialize.log" init; then
    :
  else
    status=$?
    write_status failed "${status}"
    echo "workspace backup repository initialization failed" >&2
    exit "${status}"
  fi
fi

step=stage
rm -rf -- "${BACKUP_STAGING_DIRECTORY}"
if "${state_export_bin}" "${BACKUP_SOURCE}" "${BACKUP_STAGING_DIRECTORY}" \
  >"${work_directory}/stage.log" 2>&1; then
  :
else
  status=$?
  write_status failed "${status}"
  echo "workspace state export failed" >&2
  exit "${status}"
fi

step=backup
if run_restic "${work_directory}/backup.log" backup \
  --exclude-file="${BACKUP_EXCLUDES_FILE}" \
  --host="${WORKSPACE_ID}" \
  --tag=remote-development \
  --tag="workspace:${WORKSPACE_ID}" \
  "${BACKUP_SOURCE}/home/.t3/userdata" \
  "${BACKUP_STAGING_DIRECTORY}"; then
  :
else
  status=$?
  write_status failed "${status}"
  echo "workspace backup upload failed" >&2
  exit "${status}"
fi

step=check
if run_restic "${work_directory}/check.log" check \
  --read-data-subset="${CHECK_READ_DATA_SUBSET}"; then
  :
else
  status=$?
  write_status failed "${status}"
  echo "workspace backup integrity check failed" >&2
  exit "${status}"
fi

step=retention
if run_restic "${work_directory}/retention.log" forget \
  --host="${WORKSPACE_ID}" \
  --tag="workspace:${WORKSPACE_ID}" \
  --keep-within="${KEEP_WITHIN}" \
  --keep-last="${KEEP_LAST}" \
  --prune; then
  :
else
  status=$?
  write_status failed "${status}"
  echo "workspace backup retention failed" >&2
  exit "${status}"
fi

step=complete
write_status success 0
echo "workspace backup, integrity check, and retention completed"
