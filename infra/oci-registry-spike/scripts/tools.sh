#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$project_root/versions.env"
cache_dir="$project_root/.cache"
bin_dir="$cache_dir/bin"
download_dir="$cache_dir/downloads"
mkdir -p "$bin_dir" "$download_dir"

architecture="$(uname -m)"
if [[ "$architecture" != "x86_64" ]]; then
  echo "The pinned tool bundle currently supports x86_64, found $architecture" >&2
  exit 1
fi

fetch() {
  local url="$1"
  local checksum="$2"
  local destination="$3"
  if [[ ! -f "$destination" ]] || ! printf '%s  %s\n' "$checksum" "$destination" | sha256sum --check --status; then
    curl --fail --location --retry 3 --output "$destination.tmp" "$url"
    printf '%s  %s\n' "$checksum" "$destination.tmp" | sha256sum --check --status
    mv "$destination.tmp" "$destination"
  fi
}

oras_archive="$download_dir/oras_${ORAS_VERSION}_linux_amd64.tar.gz"
fetch "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_amd64.tar.gz" "$ORAS_SHA256" "$oras_archive"
tar -xzf "$oras_archive" -C "$bin_dir" oras

helm_archive="$download_dir/helm-v${HELM_VERSION}-linux-amd64.tar.gz"
fetch "https://get.helm.sh/helm-v${HELM_VERSION}-linux-amd64.tar.gz" "$HELM_SHA256" "$helm_archive"
tar -xzf "$helm_archive" -C "$cache_dir"
install -m 0755 "$cache_dir/linux-amd64/helm" "$bin_dir/helm"

cosign_binary="$download_dir/cosign-linux-amd64"
fetch "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-amd64" "$COSIGN_SHA256" "$cosign_binary"
install -m 0755 "$cosign_binary" "$bin_dir/cosign"

kit_archive="$download_dir/kitops-linux-x86_64.tar.gz"
fetch "https://github.com/kitops-ml/kitops/releases/download/v${KITOPS_VERSION}/kitops-linux-x86_64.tar.gz" "$KITOPS_SHA256" "$kit_archive"
tar -xzf "$kit_archive" -C "$bin_dir" kit

"$bin_dir/oras" version
"$bin_dir/helm" version --short
"$bin_dir/cosign" version
"$bin_dir/kit" version

