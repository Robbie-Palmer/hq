#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
spike_dir=$(cd -- "${script_dir}/.." && pwd)
builder_name="pep-nix-spike-${RANDOM}-${RANDOM}"
oci_archive="${TMPDIR:-/tmp}/pep-nix-spike-multiarch-${RANDOM}.oci.tar"

cleanup() {
  docker buildx rm "${builder_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker buildx create \
  --driver docker-container \
  --name "${builder_name}" \
  --use >/dev/null
docker buildx inspect --bootstrap >/dev/null

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --provenance=mode=max \
  --sbom=true \
  --output "type=oci,dest=${oci_archive}" \
  "${spike_dir}/services/typescript"

printf 'Wrote non-published OCI index with attestations to %s\n' "${oci_archive}"
