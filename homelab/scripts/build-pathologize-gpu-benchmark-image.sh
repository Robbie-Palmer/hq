#!/usr/bin/env bash
set -euo pipefail

repository_root=$(git rev-parse --show-toplevel)
fixture_root=${repository_root}/ml-pipelines/pathologize-data-registry/data/raw/cptac-coad-idc/v23/b117aabf-c225-432e-95af-8ee9247a1ad6
image=ghcr.io/robbie-palmer/pathologize-gpu-benchmark:0.2.0

if [[ ! -d ${fixture_root} ]]; then
  echo "public CPTAC DICOM fixture is missing; run the data-registry acquire task" >&2
  exit 1
fi

docker build \
  --platform linux/amd64 \
  --file "${repository_root}/homelab/images/pathologize-gpu-benchmark/Dockerfile" \
  --pull=false \
  --tag "${image}" \
  "${repository_root}"
