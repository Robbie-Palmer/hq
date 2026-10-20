#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
spike_dir=$(cd -- "${script_dir}/.." && pwd)

if command -v nix >/dev/null 2>&1; then
  image_path=$(
    nix --extra-experimental-features "nix-command flakes" \
      build --no-link --no-update-lock-file --print-out-paths \
      "path:${spike_dir}#typescript-image"
  )
  docker image load <"${image_path}"
  exit 0
fi

nix_image="nixos/nix@sha256:c7cc6c8cb5d81bed19997247629604708fda95c99c43ac362daa05b6a68e8a24"
docker run --rm \
  -e "NIX_CONFIG=experimental-features = nix-command flakes" \
  -v pep-nix-build-host-spike-store:/nix \
  -v "${spike_dir}:/workspace:ro" \
  -w /workspace \
  "${nix_image}" \
  sh -euc '
    image_path=$(nix build \
      --no-link \
      --no-update-lock-file \
      --print-out-paths \
      path:.#typescript-image)
    cat "$image_path"
  ' | docker image load
