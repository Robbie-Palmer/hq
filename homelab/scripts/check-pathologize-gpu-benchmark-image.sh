#!/usr/bin/env bash
set -euo pipefail

image=ghcr.io/robbie-palmer/pathologize-gpu-benchmark:0.2.0

docker image inspect "${image}" >/dev/null
docker run --rm \
  --entrypoint python3 \
  --user 1000:1000 \
  "${image}" \
  -c 'from pathlib import Path; import cupy, nvidia.nvimgcodec, pynvml, torch, torchvision; assert cupy.cuda.runtime.runtimeGetVersion() >= 12010; assert torch.__version__.startswith("2.9.1"); assert torchvision.__version__.startswith("0.24.1"); assert len(tuple(Path("/opt/pathologize/fixtures/cptac-coad-dicom").glob("*.dcm"))) == 6'
docker run --rm \
  --user 1000:1000 \
  "${image}" \
  --help >/dev/null
