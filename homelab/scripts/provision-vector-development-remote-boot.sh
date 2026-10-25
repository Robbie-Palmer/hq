#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
doppler_project=${VECTOR_DEVELOPMENT_DOPPLER_PROJECT:-homelab}
doppler_config=${VECTOR_DEVELOPMENT_DOPPLER_CONFIG:-prd_remote_development_host}
expected_luks_uuid=526bbc1a-bafd-45df-92c7-c668dd3ffde4
luks_device=/dev/disk/by-partlabel/disk-root-root
remote_key_file=/run/vector-development-remote-unlock.key
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
remote_key_uploaded=0

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

cleanup() {
  if [[ ${remote_key_uploaded} == 1 ]]; then
    ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
      "rm -f '${remote_key_file}'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM

for command in doppler openssl ssh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
  "test \"\$(hostname)\" = vector-development && test \"\$(cryptsetup luksUUID '${luks_device}')\" = '${expected_luks_uuid}'"

lan_address=$(
  ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
    "ip -4 -o address show dev enp58s0 scope global | awk 'NR == 1 { split(\$4, address, \"/\"); print address[1] }'"
)
wol_mac=$(
  ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
    'cat /sys/class/net/enp58s0/address'
)
if [[ ! ${lan_address} =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "could not discover the Vector wired LAN address" >&2
  exit 1
fi
if [[ ! ${wol_mac} =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
  echo "could not discover the Vector wired MAC address" >&2
  exit 1
fi

if ! doppler configs get "${doppler_config}" \
  --project "${doppler_project}" >/dev/null 2>&1; then
  echo "cannot access the ${doppler_project}/${doppler_config} host-control config" >&2
  exit 1
fi

if ! doppler secrets get VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
  --project "${doppler_project}" \
  --config "${doppler_config}" >/dev/null 2>&1; then
  openssl rand -hex 32 \
    | doppler secrets set VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
        --project "${doppler_project}" \
        --config "${doppler_config}" \
        --visibility masked \
        --no-interactive \
        --silent >/dev/null
fi

printf '%s' "${lan_address}" \
  | doppler secrets set VECTOR_DEVELOPMENT_LAN_ADDRESS \
      --project "${doppler_project}" \
      --config "${doppler_config}" \
      --visibility masked \
      --no-interactive \
      --silent >/dev/null
printf '%s' "${wol_mac}" \
  | doppler secrets set VECTOR_DEVELOPMENT_WOL_MAC \
      --project "${doppler_project}" \
      --config "${doppler_config}" \
      --visibility masked \
      --no-interactive \
      --silent >/dev/null
printf '%s' '2222' \
  | doppler secrets set VECTOR_DEVELOPMENT_INITRD_SSH_PORT \
      --project "${doppler_project}" \
      --config "${doppler_config}" \
      --visibility masked \
      --no-interactive \
      --silent >/dev/null

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" 'bash -se' <<'REMOTE'
set -euo pipefail
test "$(hostname)" = vector-development
key=/etc/secrets/initrd/vector-development_ssh_host_ed25519_key
install -d -m 700 /etc/secrets/initrd
if [[ ! -s ${key} ]]; then
  ssh-keygen -q -t ed25519 -N '' -f "${key}"
fi
chown root:root "${key}" "${key}.pub"
chmod 600 "${key}"
chmod 644 "${key}.pub"
REMOTE

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
  'cat /etc/secrets/initrd/vector-development_ssh_host_ed25519_key.pub' \
  | doppler secrets set VECTOR_DEVELOPMENT_INITRD_HOST_PUBLIC_KEY \
      --project "${doppler_project}" \
      --config "${doppler_config}" \
      --visibility masked \
      --no-interactive \
      --silent >/dev/null

if [[ ${VECTOR_DEVELOPMENT_PREPARE_ONLY:-0} == 1 ]]; then
  echo "the scoped Doppler config and dedicated initrd host key are ready"
  exit 0
fi

if doppler secrets get VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
  --project "${doppler_project}" \
  --config "${doppler_config}" \
  --plain \
  | tr -d '\r\n' \
  | ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
      "cryptsetup open --test-passphrase --key-file - '${luks_device}'"; then
  echo "the vault-backed LUKS key is already enrolled"
  exit 0
fi

doppler secrets get VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
  --project "${doppler_project}" \
  --config "${doppler_config}" \
  --plain \
  | tr -d '\r\n' \
  | ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
      "umask 077; install -m 600 /dev/stdin '${remote_key_file}'"
remote_key_uploaded=1

echo "Enter the existing local LUKS passphrase at the cryptsetup prompt."
ssh -tt "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
  "set -eu; trap 'rm -f ${remote_key_file}' EXIT HUP INT TERM; \
   test \"\$(hostname)\" = vector-development; \
   test \"\$(cryptsetup luksUUID '${luks_device}')\" = '${expected_luks_uuid}'; \
   cryptsetup luksAddKey '${luks_device}' '${remote_key_file}'"

doppler secrets get VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
  --project "${doppler_project}" \
  --config "${doppler_config}" \
  --plain \
  | tr -d '\r\n' \
  | ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
      "cryptsetup open --test-passphrase --key-file - '${luks_device}'"
remote_key_uploaded=0

echo "the dedicated vault-backed LUKS key is enrolled and verified"
