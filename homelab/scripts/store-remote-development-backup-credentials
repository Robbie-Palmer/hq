#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/../.." && pwd)
doppler_project=${DOPPLER_REMOTE_DEVELOPMENT_BACKUP_PROJECT:-homelab}
doppler_config=${DOPPLER_REMOTE_DEVELOPMENT_BACKUP_CONFIG:-prd_remote_development_backup}

for command in doppler mise; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required to store workspace backup credentials" >&2
    exit 1
  fi
done

cleanup() {
  unset access_key_id secret_access_key
}
trap cleanup EXIT

IFS= read -r -s -p "Cloudflare Access Key ID: " access_key_id
printf '\n'
IFS= read -r -s -p "Cloudflare Secret Access Key: " secret_access_key
printf '\n'

if [[ ! ${access_key_id} =~ ^[0-9a-f]{32}$ ]]; then
  echo "Cloudflare Access Key ID must be 32 lowercase hexadecimal characters" >&2
  exit 1
fi
if [ -z "${secret_access_key}" ]; then
  echo "Cloudflare Secret Access Key must not be empty" >&2
  exit 1
fi

printf '%s' "${access_key_id}" \
  | doppler secrets set R2_ACCESS_KEY_ID \
    --project "${doppler_project}" \
    --config "${doppler_config}" \
    --visibility masked \
    --silent
printf '%s' "${secret_access_key}" \
  | doppler secrets set R2_SECRET_ACCESS_KEY \
    --project "${doppler_project}" \
    --config "${doppler_config}" \
    --visibility masked \
    --silent

cleanup
cd -- "${repo_root}"
mise //homelab:remote-backup-credentials

echo "workspace backup credentials stored in Doppler and installed on remote-development"
