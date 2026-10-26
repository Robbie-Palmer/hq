#!/usr/bin/env bash
set -euo pipefail

if command -v nix >/dev/null 2>&1; then
  exec nix --extra-experimental-features "nix-command flakes" "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "nix is not installed and the Docker fallback is unavailable" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
nix_image="nixos/nix@sha256:c7cc6c8cb5d81bed19997247629604708fda95c99c43ac362daa05b6a68e8a24"

docker run --rm \
  -e "NIX_CONFIG=experimental-features = nix-command flakes" \
  -v personal-site-nix-store:/nix \
  -v "${homelab_dir}:/workspace" \
  -w /workspace \
  "${nix_image}" \
  nix "$@"
