#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd -- "${script_directory}/.." && pwd)
default_inventory=${project_directory}/inventories/$(hostname -s | tr '[:upper:]' '[:lower:]').json
inventory=${1:-${PERSONAL_ARCHIVE_INVENTORY:-${default_inventory}}}
state_directory=${HOME}/.local/state/personal-archive-backup
config_directory=${HOME}/.config/personal-archive-backup
data_directory=${HOME}/.local/share/personal-archive-backup
cache_directory=${HOME}/.cache/restic
bin_directory=${HOME}/.local/bin
unit_directory=${HOME}/.config/systemd/user

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [INVENTORY_FILE]" >&2
  exit 2
fi

for command in hostname jq restic systemctl; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required" >&2; exit 1; }
done
[ -r "${inventory}" ] || { echo "personal archive inventory is not readable: ${inventory}" >&2; exit 1; }

install -d -m 0700 "${state_directory}" "${config_directory}" "${data_directory}" \
  "${cache_directory}"
install -d -m 0755 "${bin_directory}" "${unit_directory}"
jq -er '.sources[].path' "${inventory}" >"${data_directory}/sources.txt"
install -m 0600 "${project_directory}/excludes.txt" \
  "${data_directory}/excludes.txt"

archive_id=$(jq -er '.archive.id' "${inventory}")
provider=$(jq -er '.destination.provider' "${inventory}")
bucket=$(jq -er '.destination.bucket' "${inventory}")
repository_prefix=$(jq -er '.destination.repositoryPrefix' "${inventory}")
maximum_age=$(jq -er '.schedule.maximumAgeSeconds' "${inventory}")
keep_daily=$(jq -er '.retention.withinDaily' "${inventory}")
keep_monthly=$(jq -er '.retention.withinMonthly' "${inventory}")
keep_yearly=$(jq -er '.retention.withinYearly' "${inventory}")
cat >"${config_directory}/config" <<EOF
ARCHIVE_ID=${archive_id}
DESTINATION_PROVIDER=${provider}
B2_BUCKET_NAME_EXPECTED=${bucket}
REPOSITORY_PREFIX=${repository_prefix}
BACKUP_SOURCES_FILE=${data_directory}/sources.txt
BACKUP_EXCLUDES_FILE=${data_directory}/excludes.txt
BACKUP_STATUS_FILE=${state_directory}/status.json
BACKUP_CREDENTIALS_FILE=${config_directory}/restic.env
BACKUP_PASSWORD_FILE=${config_directory}/restic-password
BACKUP_LOCK_FILE=${state_directory}/backup.lock
MAXIMUM_AGE_SECONDS=${maximum_age}
CHECK_READ_DATA_SUBSET=5%
KEEP_WITHIN_DAILY=${keep_daily}
KEEP_WITHIN_MONTHLY=${keep_monthly}
KEEP_WITHIN_YEARLY=${keep_yearly}
EOF
chmod 0600 "${config_directory}/config" "${data_directory}/sources.txt"

for script in backup status restore maintenance; do
  install -m 0755 "${script_directory}/${script}.sh" \
    "${bin_directory}/personal-archive-${script}.sh"
done
for legacy_script in personal-archive-backup personal-archive-backup-status \
  personal-archive-restore personal-archive-maintenance; do
  rm -f -- "${bin_directory}/${legacy_script}"
done
ln -sfn "$(command -v restic)" "${bin_directory}/restic"

install -m 0644 "${project_directory}/systemd/personal-archive-backup.service" \
  "${unit_directory}/personal-archive-backup.service"
install -m 0644 "${project_directory}/systemd/personal-archive-backup.timer" \
  "${unit_directory}/personal-archive-backup.timer"
systemctl --user daemon-reload
echo "installed personal archive backup; credentials and timer remain disabled"
