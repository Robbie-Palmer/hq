#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
identity_file=${VECTOR_DEVELOPMENT_IDENTITY_FILE:-${HOME}/.ssh/id_ed25519}
nix_image="nixos/nix@sha256:c7cc6c8cb5d81bed19997247629604708fda95c99c43ac362daa05b6a68e8a24"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
workspace_dir=$(cd -- "${homelab_dir}/.." && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

if [[ ! -r ${identity_file} ]]; then
  echo "cannot read SSH identity ${identity_file}" >&2
  exit 1
fi

ssh_options=(
  "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}"
  -i "${identity_file}"
)

staging_dir=
remote_dir=

cleanup_remote_dir() {
  [[ -n ${remote_dir} ]] || return 0
  ssh "${ssh_options[@]}" "${target}" "rm -rf -- '${remote_dir}'"
  remote_dir=
}

cleanup_local_dir() {
  [[ -n ${staging_dir} ]] || return 0
  rm -rf -- "${staging_dir}"
  staging_dir=
}

cleanup() {
  cleanup_remote_dir || true
  cleanup_local_dir || true
}
trap cleanup EXIT

tracked_homelab_paths() {
  local path

  while IFS= read -r -d '' path; do
    if [[ -e ${homelab_dir}/${path} || -L ${homelab_dir}/${path} ]]; then
      printf '%s\0' "${path}"
    fi
  done < <(git -C "${homelab_dir}" ls-files -z --cached -- .)
}

stage_homelab() {
  local candidate

  candidate=$(mktemp -d "${workspace_dir}/.vector-development-rebuild.XXXXXX")
  case ${candidate} in
    "${workspace_dir}"/.vector-development-rebuild.[A-Za-z0-9]*) ;;
    *)
      echo "unexpected local rebuild directory: ${candidate}" >&2
      exit 1
      ;;
  esac
  staging_dir=${candidate}

  tracked_homelab_paths \
    | COPYFILE_DISABLE=1 tar --no-xattrs --null -C "${homelab_dir}" -T - -cf - \
    | tar -C "${staging_dir}" -xf -
  if [[ -e ${staging_dir}/.kube ]]; then
    echo "refusing rebuild input containing local Kubernetes credentials" >&2
    exit 1
  fi
}

rebuild_on_vector() {
  local candidate

  candidate=$(ssh "${ssh_options[@]}" "${target}" 'mktemp -d /tmp/vector-development-rebuild.XXXXXX')
  if [[ ! ${candidate} =~ ^/tmp/vector-development-rebuild\.[A-Za-z0-9]+$ ]]; then
    echo "unexpected remote rebuild directory: ${candidate}" >&2
    exit 1
  fi
  remote_dir=${candidate}

  COPYFILE_DISABLE=1 tar --no-xattrs -C "${staging_dir}" -cf - . |
    ssh "${ssh_options[@]}" "${target}" "tar -C '${remote_dir}' -xf -"
  ssh "${ssh_options[@]}" "${target}" \
    "nixos-rebuild switch --flake '${remote_dir}#vector-development'"
  cleanup_remote_dir
}

stage_homelab

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker run --rm \
    --network host \
    -e "NIX_CONFIG=experimental-features = nix-command flakes" \
    -e "NIX_SSHOPTS=-i /run/vector-development-identity -o UserKnownHostsFile=/run/vector-development-known-hosts -o StrictHostKeyChecking=accept-new" \
    -v personal-site-nix-store:/nix \
    -v "${staging_dir}:/workspace" \
    -v "${identity_file}:/run/vector-development-identity:ro" \
    -v "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}:/run/vector-development-known-hosts" \
    -w /workspace \
    "${nix_image}" \
    nix run .#nixosConfigurations.vector-development.config.system.build.nixos-rebuild -- \
    switch \
    --flake .#vector-development \
    --build-host "${target}" \
    --target-host "${target}"
else
  echo "Docker is unavailable; rebuilding directly on ${target}"
  rebuild_on_vector
fi

if [[ ${VECTOR_DEVELOPMENT_SKIP_HEALTH:-0} != 1 ]]; then
  "${script_dir}/vector-development-health.sh"
fi
