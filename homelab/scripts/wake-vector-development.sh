#!/usr/bin/env bash
set -euo pipefail

doppler_project=${VECTOR_DEVELOPMENT_DOPPLER_PROJECT:-homelab}
doppler_config=${VECTOR_DEVELOPMENT_DOPPLER_CONFIG:-prd_remote_development_host}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
known_hosts=$(mktemp "${TMPDIR:-/tmp}/vector-initrd-known-hosts.XXXXXX")
trap 'rm -f "${known_hosts}"' EXIT HUP INT TERM
chmod 600 "${known_hosts}"

for command in doppler python3 ssh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

secret() {
  local name=$1

  doppler secrets get "${name}" \
    --project "${doppler_project}" \
    --config "${doppler_config}" \
    --plain
}

address=$(secret VECTOR_DEVELOPMENT_LAN_ADDRESS)
mac=$(secret VECTOR_DEVELOPMENT_WOL_MAC)
port=$(secret VECTOR_DEVELOPMENT_INITRD_SSH_PORT)
host_public_key=$(secret VECTOR_DEVELOPMENT_INITRD_HOST_PUBLIC_KEY)
target="root@${address}"

if [[ ! ${address} =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "the configured Vector LAN address is invalid" >&2
  exit 1
fi
if [[ ! ${mac} =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
  echo "the configured Vector Wake-on-LAN MAC address is invalid" >&2
  exit 1
fi
if [[ ! ${port} =~ ^[0-9]+$ ]]; then
  echo "the configured Vector initrd SSH port is invalid" >&2
  exit 1
fi
if [[ ! ${host_public_key} =~ ^ssh-ed25519[[:space:]] ]]; then
  echo "the configured Vector initrd host public key is invalid" >&2
  exit 1
fi
printf '[%s]:%s %s\n' "${address}" "${port}" "${host_public_key}" >"${known_hosts}"

port_open() {
  local host=$1
  local port=$2

  python3 - "${host}" "${port}" <<'PY'
import socket
import sys

try:
    with socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=2):
        pass
except OSError:
    raise SystemExit(1)
PY
}

send_magic_packet() {
  python3 - "${mac}" <<'PY'
import socket
import sys

mac = bytes.fromhex(sys.argv[1].replace(":", ""))
packet = b"\xff" * 6 + mac * 16
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    for port in (7, 9):
        sock.sendto(packet, ("255.255.255.255", port))
PY
}

if port_open "${address}" 22; then
  echo "Vector is already running; checking its services"
  VECTOR_DEVELOPMENT_TAILNET_TARGET="${target}" "${script_dir}/vector-development-health.sh"
  exit 0
fi

send_magic_packet
echo "sent the Vector magic packet"

for wake_attempt in $(seq 1 60); do
  if port_open "${address}" "${port}"; then
    break
  fi
  if ((wake_attempt % 5 == 0)); then
    send_magic_packet
    echo "resent the Vector magic packet (${wake_attempt}/60)"
  fi
  sleep 2
done
if ! port_open "${address}" "${port}"; then
  echo "Vector did not expose initrd SSH during the bounded wake period" >&2
  echo "check AC power, Ethernet, the DHCP reservation, and the UEFI Wake-on-LAN setting" >&2
  exit 1
fi

doppler secrets get VECTOR_DEVELOPMENT_LUKS_REMOTE_KEY \
  --project "${doppler_project}" \
  --config "${doppler_config}" \
  --plain \
  | tr -d '\r\n' \
  | ssh \
      -T \
      -p "${port}" \
      -o BatchMode=yes \
      -o ConnectTimeout=8 \
      -o PreferredAuthentications=publickey \
      -o StrictHostKeyChecking=yes \
      -o "UserKnownHostsFile=${known_hosts}" \
      "root@${address}"
echo "submitted the vault-backed key to the Vector initrd"

for _ in $(seq 1 90); do
  if port_open "${address}" 22; then
    for health_attempt in $(seq 1 12); do
      if VECTOR_DEVELOPMENT_TAILNET_TARGET="${target}" \
        "${script_dir}/vector-development-health.sh"; then
        exit 0
      fi
      echo "Vector services are not ready yet (${health_attempt}/12)" >&2
      sleep 10
    done
    echo "Vector booted but did not pass its service health check" >&2
    exit 1
  fi
  sleep 2
done

echo "Vector accepted the unlock request but did not finish booting within three minutes" >&2
exit 1
