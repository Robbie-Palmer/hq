#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
spike_dir=$(cd -- "${script_dir}/.." && pwd)
comparison_dir=$(mktemp -d)
container_ids=()

cleanup() {
  if ((${#container_ids[@]} > 0)); then
    docker container rm --force "${container_ids[@]}" >/dev/null 2>&1 || true
  fi
  docker run --rm -v "${comparison_dir}:/comparison" \
    alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8 \
    rm -rf /comparison >/dev/null 2>&1 || true
  rmdir "${comparison_dir}" 2>/dev/null || true
}
trap cleanup EXIT

docker buildx build \
  --load \
  --tag pep-nix-spike:dockerfile \
  "${spike_dir}/services/typescript"
"${script_dir}/load-nix-image.sh"

printf 'variant\tsize_bytes\tlayers\tsbom_packages\tcritical_or_high_vulnerabilities\n'

for variant in dockerfile nix; do
  image="pep-nix-spike:${variant}"
  container_id=$(docker run --detach --publish 127.0.0.1::8080 "${image}")
  container_ids+=("${container_id}")
  host_port=$(docker port "${container_id}" 8080/tcp | awk -F: 'NR == 1 { print $NF }')

  healthy=false
  for _ in $(seq 1 30); do
    if curl --fail --silent "http://127.0.0.1:${host_port}/health" \
      | grep --quiet '"status":"ok"'; then
      healthy=true
      break
    fi
    sleep 1
  done
  if [[ "${healthy}" != true ]]; then
    echo "${image} did not become healthy" >&2
    exit 1
  fi

  sbom_path="${comparison_dir}/${variant}-sbom.json"
  scan_path="${comparison_dir}/${variant}-scan.json"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${comparison_dir}:/output" \
    anchore/syft:v1.54.1@sha256:3eb5379ba7b409c3f4069b686110527af0c47df993fa5c10d13e7cf34f49b1aa \
    "docker:${image}" \
    --output "cyclonedx-json=/output/${variant}-sbom.json" \
    --quiet
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v pep-nix-build-host-spike-trivy-cache:/root/.cache/ \
    -v "${comparison_dir}:/output" \
    aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222 \
    image \
    --format json \
    --output "/output/${variant}-scan.json" \
    --quiet \
    --scanners vuln \
    "${image}"

  size=$(docker image inspect "${image}" --format '{{.Size}}')
  layers=$(docker image inspect "${image}" --format '{{len .RootFS.Layers}}')
  packages=$(jq '.components | length' "${sbom_path}")
  vulnerabilities=$(
    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH")] | length' \
      "${scan_path}"
  )
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "${variant}" "${size}" "${layers}" "${packages}" "${vulnerabilities}"
done
