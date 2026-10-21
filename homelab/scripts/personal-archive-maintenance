#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --apply ]; }; then
  echo "Usage: $0 [--apply]" >&2
  exit 2
fi

config_file=${PERSONAL_ARCHIVE_CONFIG:-$HOME/.config/personal-archive-backup/config}
credentials_file=${PERSONAL_ARCHIVE_MAINTENANCE_CREDENTIALS:-}
restic_bin=${RESTIC_BIN:-restic}
if [ ! -r "${config_file}" ] || [ ! -r "${credentials_file}" ]; then
  echo "maintenance configuration is incomplete" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${config_file}"
set -a
# shellcheck source=/dev/null
source "${credentials_file}"
set +a
export RESTIC_PASSWORD_FILE="${BACKUP_PASSWORD_FILE}"

exec 9>"${BACKUP_LOCK_FILE}"
flock -n 9 || { echo "a backup or maintenance run is active" >&2; exit 1; }

mode=(--dry-run)
if [ "${1:-}" = --apply ]; then
  mode=()
  "${restic_bin}" unlock --remove-all
fi

"${restic_bin}" forget \
  --host="${ARCHIVE_ID}" --tag="archive:${ARCHIVE_ID}" \
  --keep-within-daily="${KEEP_WITHIN_DAILY}" \
  --keep-within-monthly="${KEEP_WITHIN_MONTHLY}" \
  --keep-within-yearly="${KEEP_WITHIN_YEARLY}" \
  --prune "${mode[@]}"
