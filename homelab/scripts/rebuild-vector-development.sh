#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
identity_file=${VECTOR_DEVELOPMENT_IDENTITY_FILE:-${HOME}/.ssh/id_ed25519}
nix_image="nixos/nix@sha256:c7cc6c8cb5d81bed19997247629604708fda95c99c43ac362daa05b6a68e8a24"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

if [[ ! -r ${identity_file} ]]; then
  echo "cannot read SSH identity ${identity_file}" >&2
  exit 1
fi

docker run --rm \
  --network host \
  -e "NIX_CONFIG=experimental-features = nix-command flakes" \
  -e "NIX_SSHOPTS=-i /run/vector-development-identity -o UserKnownHostsFile=/run/vector-development-known-hosts -o StrictHostKeyChecking=accept-new" \
  -v personal-site-nix-store:/nix \
  -v "${homelab_dir}:/workspace" \
  -v "${identity_file}:/run/vector-development-identity:ro" \
  -v "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}:/run/vector-development-known-hosts" \
  -w /workspace \
  "${nix_image}" \
  nix run .#nixosConfigurations.vector-development.config.system.build.nixos-rebuild -- \
    switch \
    --flake .#vector-development \
    --build-host "${target}" \
    --target-host "${target}"

if [[ ${VECTOR_DEVELOPMENT_SKIP_HEALTH:-0} != 1 ]]; then
  "${script_dir}/vector-development-health.sh"
fi
