#!/usr/bin/env bash
set -euo pipefail

doppler_project=${DOPPLER_PERSONAL_ARCHIVE_PROJECT:-homelab}
doppler_config=${DOPPLER_PERSONAL_ARCHIVE_CONFIG:-prd_personal_archive_backup}
config_directory=${HOME}/.config/personal-archive-backup

for command in doppler systemctl; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required" >&2; exit 1; }
done
[ -r "${config_directory}/config" ] || { echo "install the personal archive job first" >&2; exit 1; }
# shellcheck source=/dev/null
source "${config_directory}/config"
for name in B2_BUCKET_NAME_EXPECTED REPOSITORY_PREFIX; do
  [ -n "${!name:-}" ] || { echo "installed configuration is missing ${name}" >&2; exit 1; }
done

read_secret() {
  doppler secrets get "$1" --project "${doppler_project}" --config "${doppler_config}" --plain
}

temporary_directory=$(mktemp -d)
cleanup() {
  unset endpoint bucket key_id application_key password ping_url
  if command -v shred >/dev/null 2>&1; then
    shred --remove "${temporary_directory}/restic.env" \
      "${temporary_directory}/restic-password" 2>/dev/null || true
  else
    rm -f -- "${temporary_directory}/restic.env" \
      "${temporary_directory}/restic-password"
  fi
  rmdir "${temporary_directory}" 2>/dev/null || true
}
trap cleanup EXIT
umask 077
endpoint=$(read_secret B2_S3_ENDPOINT)
bucket=$(read_secret B2_BUCKET_NAME)
key_id=$(read_secret B2_BACKUP_KEY_ID)
application_key=$(read_secret B2_BACKUP_APPLICATION_KEY)
password=$(read_secret RESTIC_PASSWORD)
ping_url=$(read_secret HEALTHCHECKS_PING_URL)
[[ ${endpoint} =~ ^s3\.[a-z0-9-]+\.backblazeb2\.com$ ]] || { echo "invalid B2 S3 endpoint" >&2; exit 1; }
[ "${bucket}" = "${B2_BUCKET_NAME_EXPECTED}" ] || { echo "B2 bucket does not match installed inventory" >&2; exit 1; }
[[ ${ping_url} =~ ^https://hc-ping\.com/[A-Za-z0-9_-]+/?$ ]] || { echo "invalid Healthchecks.io ping URL" >&2; exit 1; }
for value in "${key_id}" "${application_key}" "${password}"; do
  [ -n "${value}" ] || { echo "personal archive credentials must not be empty" >&2; exit 1; }
done

printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nRESTIC_REPOSITORY=%s\nHEALTHCHECKS_PING_URL=%s\n' \
  "${key_id}" "${application_key}" "s3:https://${endpoint}/${bucket}/${REPOSITORY_PREFIX}" "${ping_url}" \
  >"${temporary_directory}/restic.env"
printf '%s\n' "${password}" >"${temporary_directory}/restic-password"
install -m 0600 "${temporary_directory}/restic.env" "${config_directory}/restic.env"
install -m 0600 "${temporary_directory}/restic-password" "${config_directory}/restic-password"
systemctl --user enable --now personal-archive-backup.timer
echo "installed personal archive credentials and enabled the daily timer"
