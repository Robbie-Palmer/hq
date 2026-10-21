#!/usr/bin/env bash
set -euo pipefail

config_file=${PERSONAL_ARCHIVE_CONFIG:-$HOME/.config/personal-archive-backup/config}
restic_bin=${RESTIC_BIN:-restic}

if [[ ! -r "${config_file}" ]]; then
  echo "personal archive configuration is not readable" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${config_file}"

for name in ARCHIVE_ID DESTINATION_PROVIDER BACKUP_SOURCES_FILE \
  BACKUP_EXCLUDES_FILE BACKUP_STATUS_FILE BACKUP_CREDENTIALS_FILE \
  BACKUP_PASSWORD_FILE BACKUP_LOCK_FILE CHECK_READ_DATA_SUBSET; do
  if [[ -z "${!name:-}" ]]; then
    echo "personal archive configuration is missing ${name}" >&2
    exit 1
  fi
done
for file in "${BACKUP_SOURCES_FILE}" "${BACKUP_EXCLUDES_FILE}" \
  "${BACKUP_CREDENTIALS_FILE}" "${BACKUP_PASSWORD_FILE}"; do
  if [[ ! -r "${file}" ]]; then
    echo "personal archive input is not readable" >&2
    exit 1
  fi
done

set -a
# shellcheck source=/dev/null
source "${BACKUP_CREDENTIALS_FILE}"
set +a
if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
  echo "RESTIC_REPOSITORY is not set" >&2
  exit 1
fi
if [[ "${DESTINATION_PROVIDER}" = backblaze-b2 ]]; then
  for name in B2_BUCKET_NAME_EXPECTED REPOSITORY_PREFIX; do
    if [[ -z "${!name:-}" ]]; then
      echo "personal archive configuration is missing ${name}" >&2
      exit 1
    fi
  done
  case "${RESTIC_REPOSITORY}" in
    s3:https://s3.*.backblazeb2.com/"${B2_BUCKET_NAME_EXPECTED}/${REPOSITORY_PREFIX}") ;;
    *)
      echo "RESTIC_REPOSITORY does not match the installed inventory" >&2
      exit 1
      ;;
  esac
fi
export RESTIC_PASSWORD_FILE="${BACKUP_PASSWORD_FILE}"

mapfile -t sources < <(sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "${BACKUP_SOURCES_FILE}")
if [[ "${#sources[@]}" -eq 0 ]]; then
  echo "personal archive has no configured sources" >&2
  exit 1
fi
for source_path in "${sources[@]}"; do
  if [[ ! -d "${source_path}" ]]; then
    echo "personal archive source is unavailable" >&2
    exit 1
  fi
done

status_directory=$(dirname -- "${BACKUP_STATUS_FILE}")
install -d -m 0700 "${status_directory}"
exec 9>"${BACKUP_LOCK_FILE}"
if ! flock -n 9; then
  echo "another personal archive backup is running" >&2
  exit 1
fi

work_directory=$(mktemp -d "${status_directory}/run.XXXXXX")
chmod 0700 "${work_directory}"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
started_unix=$(date +%s)
step=initialization
finished=false
last_success_at=null
last_success_unix=null

if [[ -r "${BACKUP_STATUS_FILE}" ]]; then
  last_success_at=$(jq -r '.lastSuccessAt // "null"' "${BACKUP_STATUS_FILE}" 2>/dev/null || printf null)
  last_success_unix=$(jq -r '.lastSuccessUnix // "null"' "${BACKUP_STATUS_FILE}" 2>/dev/null || printf null)
fi

write_status() {
  local state=$1 exit_code=$2 repository_bytes=${3:-null}
  local completed_at completed_unix temporary_status
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  completed_unix=$(date +%s)
  temporary_status="${work_directory}/status.json"
  if [[ "${state}" = success ]]; then
    last_success_at=${completed_at}
    last_success_unix=${completed_unix}
  fi
  jq --null-input \
    --arg archiveId "${ARCHIVE_ID}" \
    --arg destinationProvider "${DESTINATION_PROVIDER}" \
    --arg state "${state}" \
    --arg failedStep "${step}" \
    --arg startedAt "${started_at}" \
    --arg completedAt "${completed_at}" \
    --arg lastSuccessAt "${last_success_at}" \
    --argjson startedUnix "${started_unix}" \
    --argjson completedUnix "${completed_unix}" \
    --argjson lastSuccessUnix "${last_success_unix}" \
    --argjson repositoryBytes "${repository_bytes}" \
    --argjson exitCode "${exit_code}" \
    '{schemaVersion: 1, archiveId: $archiveId,
      destinationProvider: $destinationProvider, state: $state,
      failedStep: (if $state == "success" then null else $failedStep end),
      exitCode: $exitCode, startedAt: $startedAt, startedUnix: $startedUnix,
      completedAt: $completedAt, completedUnix: $completedUnix,
      lastSuccessAt: (if $lastSuccessAt == "null" then null else $lastSuccessAt end),
      lastSuccessUnix: $lastSuccessUnix, repositoryBytes: $repositoryBytes}' \
    >"${temporary_status}"
  chmod 0600 "${temporary_status}"
  mv -f -- "${temporary_status}" "${BACKUP_STATUS_FILE}"
}

cleanup() {
  local exit_code=$?
  if [[ "${finished}" != true ]]; then
    write_status failed "${exit_code}" || true
  fi
  rm -rf -- "${work_directory}"
  exit "${exit_code}"
}
trap cleanup EXIT

run_restic() {
  local log_file=$1
  shift
  "${restic_bin}" "$@" >"${log_file}" 2>&1
}

if ! run_restic "${work_directory}/repository.log" --no-lock snapshots --latest 1 --json; then
  step=initialize
  run_restic "${work_directory}/initialize.log" --no-lock init
fi

step=backup
run_restic "${work_directory}/backup.log" --no-lock backup \
  --exclude-file="${BACKUP_EXCLUDES_FILE}" \
  --host="${ARCHIVE_ID}" \
  --tag=personal-archive \
  --tag="archive:${ARCHIVE_ID}" \
  --json \
  "${sources[@]}"

step=check
run_restic "${work_directory}/check.log" --no-lock check \
  --read-data-subset="${CHECK_READ_DATA_SUBSET}"

step=measure
run_restic "${work_directory}/stats.json" --no-lock stats latest \
  --host="${ARCHIVE_ID}" --tag="archive:${ARCHIVE_ID}" \
  --mode=raw-data --json
repository_bytes=$(jq -er '.total_size' "${work_directory}/stats.json")

step=complete
write_status success 0 "${repository_bytes}"
finished=true
echo "personal archive backup and integrity check completed"
