#!/usr/bin/env bash
set -euo pipefail

target=${REMOTE_DEVELOPMENT_TARGET:-root@188.245.208.107}
identity_file=${REMOTE_DEVELOPMENT_IDENTITY_FILE:-${HOME}/.ssh/id_ed25519}
project=homelab
config=prd_remote_development_host
nix_image="nixos/nix@sha256:c7cc6c8cb5d81bed19997247629604708fda95c99c43ac362daa05b6a68e8a24"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
secret_dir=$(mktemp -d)
secret_file="${secret_dir}/var/lib/remote-development-secrets/data-volume.key"

source "${script_dir}/remote-development-ssh.sh"
remote_development_prepare_ssh "${target}"

cleanup() {
  if [ -f "${secret_file}" ]; then
    shred --remove "${secret_file}" 2>/dev/null || rm -f "${secret_file}"
  fi
  rmdir "${secret_dir}/var/lib/remote-development-secrets" 2>/dev/null || true
  rmdir "${secret_dir}/var/lib" 2>/dev/null || true
  rmdir "${secret_dir}/var" 2>/dev/null || true
  rmdir "${secret_dir}" 2>/dev/null || true
}
trap cleanup EXIT

for command in docker doppler ssh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

if [ ! -r "${identity_file}" ]; then
  echo "cannot read SSH identity ${identity_file}" >&2
  exit 1
fi

ssh "${REMOTE_DEVELOPMENT_SSH_OPTIONS[@]}" -i "${identity_file}" "${target}" '
  set -eu
  root_disk=/dev/disk/by-path/pci-0000:06:00.0-scsi-0:0:0:0
  data_disk=/dev/disk/by-id/scsi-0HC_Volume_106792547
  test -b "${root_disk}"
  test -b "${data_disk}"
  test "$(lsblk -ndo SERIAL "${data_disk}")" = 106792547
  test "$(blkid -s TYPE -o value "${data_disk}")" = crypto_LUKS
  test "$(readlink -f "${root_disk}")" != "$(readlink -f "${data_disk}")"
  root_source=$(readlink -f "$(findmnt --noheadings --output SOURCE /)")
  root_parent=/dev/$(lsblk --noheadings --output PKNAME "${root_source}" | tr -d "[:space:]")
  test "$(readlink -f "${root_disk}")" = "${root_parent}"
  test "$(lsblk --noheadings --output MODEL "${root_disk}" | xargs)" = "QEMU HARDDISK"
' \
  || {
    echo "root and encrypted data disk identities did not pass the installation guard" >&2
    exit 1
  }

mkdir -p "$(dirname -- "${secret_file}")"
doppler secrets get DATA_VOLUME_LUKS_KEY \
  --project "${project}" \
  --config "${config}" \
  --plain \
  | install -m 600 /dev/stdin "${secret_file}"

docker run --rm \
  --network host \
  -e "NIX_CONFIG=experimental-features = nix-command flakes" \
  -v personal-site-nix-store:/nix \
  -v "${homelab_dir}:/workspace" \
  -v "${identity_file}:/run/remote-development-identity:ro" \
  -v "${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}:/run/remote-development-known-hosts" \
  -v "${secret_dir}:/run/remote-development-extra-files:ro" \
  -w /workspace \
  "${nix_image}" \
  nix run .#nixos-anywhere -- \
    --flake .#remote-development \
    --target-host "${target}" \
    -i /run/remote-development-identity \
    --extra-files /run/remote-development-extra-files \
    --copy-host-keys \
    --ssh-option UserKnownHostsFile=/run/remote-development-known-hosts \
    --ssh-option StrictHostKeyChecking=yes \
    --build-on local
