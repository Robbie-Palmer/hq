#!/usr/bin/env bash
set -euo pipefail

image=ghcr.io/robbie-palmer/pathologize-cucim-benchmark:0.1.0

docker image inspect "${image}" >/dev/null
docker run --rm \
  --entrypoint python3 \
  --user 1000:1000 \
  "${image}" \
  -c 'from importlib import metadata; from pathlib import Path; import cucim, cupy, openslide, tifffile; assert metadata.version("cucim-cu12") == "26.10.0"; assert metadata.version("cupy-cuda12x") == "14.2.0"; assert openslide.__version__; assert tifffile.__version__; assert Path("/usr/local/lib/python3.12/dist-packages/nvidia/nvimgcodec/libnvimgcodec.so.0").is_file(); assert len(tuple(Path("/opt/pathologize/fixtures/tiff-gpu").glob("**/*.*"))) == 7'
docker run --rm \
  --user 1000:1000 \
  "${image}" \
  --help >/dev/null
