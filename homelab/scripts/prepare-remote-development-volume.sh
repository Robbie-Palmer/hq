#!/usr/bin/env bash
set -euo pipefail

target=${REMOTE_DEVELOPMENT_TARGET:-root@188.245.208.107}
device=/dev/disk/by-id/scsi-0HC_Volume_106792547
project=homelab
config=prd_remote_development_host
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/remote-development-ssh.sh"
remote_development_prepare_ssh "${target}"

for command in doppler ssh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

if ! doppler secrets get DATA_VOLUME_LUKS_KEY \
  --project "${project}" \
  --config "${config}" \
  --plain >/dev/null 2>&1; then
  echo "DATA_VOLUME_LUKS_KEY is missing from ${project}/${config}" >&2
  exit 1
fi

read -r -d '' remote_command <<'REMOTE' || true
set -euo pipefail
device=/dev/disk/by-id/scsi-0HC_Volume_106792547
mapper=remote-development-data
key_file=$(mktemp /run/remote-development-volume-key.XXXXXX)
mount_dir=$(mktemp -d /run/remote-development-volume-check.XXXXXX)
cleanup() {
  if [ -e "/dev/mapper/${mapper}" ]; then
    cryptsetup close "${mapper}" || true
  fi
  if mountpoint -q "${mount_dir}"; then
    umount "${mount_dir}" || true
  fi
  shred --remove "${key_file}" 2>/dev/null || rm -f "${key_file}"
  rmdir "${mount_dir}" 2>/dev/null || true
}
trap cleanup EXIT
chmod 600 "${key_file}"
cat >"${key_file}"

if [ "$(lsblk -ndo SERIAL "${device}")" != "106792547" ]; then
  echo "refusing to touch a device whose serial is not 106792547" >&2
  exit 1
fi

if ! command -v cryptsetup >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -qq -y cryptsetup
fi

device_type=$(blkid -s TYPE -o value "${device}" || true)
case "${device_type}" in
  crypto_LUKS)
    cryptsetup open --test-passphrase --key-file "${key_file}" "${device}"
    echo "encrypted data volume and recovery key verified"
    ;;
  ext4)
    mount -o ro "${device}" "${mount_dir}"
    unexpected=$(find "${mount_dir}" -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit)
    umount "${mount_dir}"
    if [ -n "${unexpected}" ]; then
      echo "refusing to encrypt a non-empty data volume" >&2
      exit 1
    fi
    cryptsetup luksFormat --type luks2 --batch-mode --key-file "${key_file}" "${device}"
    cryptsetup open --key-file "${key_file}" "${device}" "${mapper}"
    mkfs.ext4 \
      -O project,quota \
      -E quotatype=prjquota \
      -L remote-dev-data \
      "/dev/mapper/${mapper}"
    sync
    udevadm settle
    cryptsetup close "${mapper}"
    echo "empty data volume encrypted and formatted"
    ;;
  *)
    echo "refusing to touch data volume with filesystem type '${device_type:-unknown}'" >&2
    exit 1
    ;;
esac
REMOTE

doppler secrets get DATA_VOLUME_LUKS_KEY \
  --project "${project}" \
  --config "${config}" \
  --plain \
  | ssh \
      "${REMOTE_DEVELOPMENT_SSH_OPTIONS[@]}" \
      "${target}" \
      "${remote_command}"
