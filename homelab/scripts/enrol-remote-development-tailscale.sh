#!/usr/bin/env bash
set -euo pipefail

target=${REMOTE_DEVELOPMENT_TARGET:-root@188.245.208.107}
project=homelab
config=prd_remote_development_host
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/remote-development-ssh.sh"
remote_development_prepare_ssh "${target}"

if ! doppler secrets get TAILSCALE_AUTH_KEY \
  --project "${project}" \
  --config "${config}" \
  --plain >/dev/null 2>&1; then
  echo "TAILSCALE_AUTH_KEY is missing from ${project}/${config}" >&2
  echo "Create a one-use, tagged, pre-authorized key with device ephemerality disabled." >&2
  exit 1
fi

read -r -d '' remote_command <<'REMOTE' || true
set -euo pipefail
key_file=$(mktemp /run/tailscale-auth-key.XXXXXX)
cleanup() {
  shred --remove "${key_file}" 2>/dev/null || rm -f "${key_file}"
}
trap cleanup EXIT
chmod 600 "${key_file}"
cat >"${key_file}"
tailscale up \
  --auth-key="file:${key_file}" \
  --hostname=remote-development \
  --advertise-tags=tag:remote-development \
  --ssh \
  --reset
tailscale status
tailscale ip -4
systemctl restart t3-code-tailscale-serve.service
REMOTE

doppler secrets get TAILSCALE_AUTH_KEY \
  --project "${project}" \
  --config "${config}" \
  --plain \
  | ssh \
      "${REMOTE_DEVELOPMENT_SSH_OPTIONS[@]}" \
      "${target}" \
      "${remote_command}"
