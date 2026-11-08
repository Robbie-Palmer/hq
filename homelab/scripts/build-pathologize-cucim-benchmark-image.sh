#!/usr/bin/env bash
set -euo pipefail

repository_root=$(git rev-parse --show-toplevel)
fixture_root=${repository_root}/ml-pipelines/pathologize-tiling-benchmark/data/tiff-gpu
image=ghcr.io/robbie-palmer/pathologize-cucim-benchmark:0.1.0

if [[ ! -d ${fixture_root} ]]; then
  echo "public TIFF fixtures are missing; run the fixture acquisition task" >&2
  exit 1
fi

docker build \
  --platform linux/amd64 \
  --file "${repository_root}/homelab/images/pathologize-cucim-benchmark/Dockerfile" \
  --pull=false \
  --provenance=false \
  --tag "${image}" \
  "${repository_root}"
