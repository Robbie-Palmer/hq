#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 EMPTY_TARGET_DIRECTORY" >&2
  exit 2
fi

target=$1
config_file=${PERSONAL_ARCHIVE_CONFIG:-$HOME/.config/personal-archive-backup/config}
credentials_file=${PERSONAL_ARCHIVE_RECOVERY_CREDENTIALS:-}
password_file=${PERSONAL_ARCHIVE_RECOVERY_PASSWORD:-}
restic_bin=${RESTIC_BIN:-restic}

if [ ! -r "${config_file}" ] || [ ! -r "${credentials_file}" ] || [ ! -r "${password_file}" ]; then
  echo "independent recovery configuration is incomplete" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${config_file}"
set -a
# shellcheck source=/dev/null
source "${credentials_file}"
set +a
export RESTIC_PASSWORD_FILE="${password_file}"

install -d -m 0700 "${target}"
if [ -n "$(find "${target}" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "restore target must be empty" >&2
  exit 1
fi

"${restic_bin}" --no-lock restore latest \
  --host="${ARCHIVE_ID}" --tag="archive:${ARCHIVE_ID}" \
  --target="${target}" --verify

echo "personal archive restore completed and repository checksums matched"
