#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 EMPTY_TARGET_DIRECTORY" >&2
  exit 2
fi

target=$1
config_file=${WORKSPACE_BACKUP_CONFIG:-/etc/remote-development-workspace-backup/config}
restic_bin=${RESTIC_BIN:-restic}

if [ ! -r "${config_file}" ]; then
  echo "workspace backup configuration is not readable" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${config_file}"

for name in WORKSPACE_ID BACKUP_SOURCE BACKUP_STAGING_DIRECTORY \
  BACKUP_CREDENTIALS_FILE BACKUP_PASSWORD_FILE; do
  if [ -z "${!name:-}" ]; then
    echo "workspace backup configuration is missing ${name}" >&2
    exit 1
  fi
done

if [ ! -r "${BACKUP_CREDENTIALS_FILE}" ]; then
  echo "workspace backup credentials are not readable" >&2
  exit 1
fi
if [ ! -r "${BACKUP_PASSWORD_FILE}" ]; then
  echo "workspace backup password file is not readable" >&2
  exit 1
fi

# shellcheck source=/dev/null
set -a
# shellcheck source=/dev/null
source "${BACKUP_CREDENTIALS_FILE}"
set +a
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  echo "RESTIC_REPOSITORY is not set" >&2
  exit 1
fi
export RESTIC_PASSWORD_FILE="${BACKUP_PASSWORD_FILE}"

if [ ! -d "${target}" ]; then
  install -d -m 0700 "${target}"
fi
if [ -n "$(find "${target}" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "restore target must be empty" >&2
  exit 1
fi

"${restic_bin}" restore latest \
  --host="${WORKSPACE_ID}" \
  --tag="workspace:${WORKSPACE_ID}" \
  --target="${target}"

restored_source="${target}${BACKUP_SOURCE}"
restored_userdata="${restored_source}/home/.t3/userdata"
restored_export="${target}${BACKUP_STAGING_DIRECTORY}"
if [ ! -r "${restored_export}/t3-databases/statev2.sqlite" ] \
  || [ ! -r "${restored_export}/t3-databases/server-owner.sqlite" ] \
  || [ ! -r "${restored_export}/manifest.json" ]; then
  echo "restored workspace is missing required T3 state" >&2
  exit 1
fi

install -d -m 0700 "${restored_userdata}"
install -m 0600 "${restored_export}/t3-databases/statev2.sqlite" \
  "${restored_userdata}/statev2.sqlite"
install -m 0600 "${restored_export}/t3-databases/server-owner.sqlite" \
  "${restored_userdata}/server-owner.sqlite"

echo "workspace restore completed; T3 state and in-flight worktree exports are present"
