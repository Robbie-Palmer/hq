#!/usr/bin/env bash
set -euo pipefail

mode=${1:-all}
export PIP_BREAK_SYSTEM_PACKAGES=1

install_dependencies() {
  export DEBIAN_FRONTEND=noninteractive

  apt-get update
  apt-get install --yes --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip
  rm --recursive --force /var/lib/apt/lists/*

  python3 -m pip install --no-cache-dir --only-binary=:all: \
    cupy-cuda12x==14.2.0 \
    cuda-pathfinder==1.8.6 \
    nvidia-cuda-runtime-cu12==12.9.79 \
    nvidia-cuda-nvrtc-cu12==12.9.86 \
    nvidia-libnvcomp-cu12==5.3.0.16 \
    nvidia-nvjpeg-cu12==12.4.0.76 \
    nvidia-nvjpeg2k-cu12==0.12.0.58 \
    nvidia-nvtiff-cu12==0.9.0.86 \
    nvidia-nvimgcodec-cu12==0.9.0.20 \
    click==8.5.1 \
    imageio==2.38.1 \
    lazy-loader==0.6 \
    networkx==3.7 \
    numpy==2.5.4 \
    packaging==26.3 \
    pillow==13.0.0 \
    scikit-image==0.26.0 \
    scipy==1.18.1 \
    tifffile==2026.10.15
  python3 -m pip install --no-cache-dir --no-deps --only-binary=:all: \
    cucim-cu12==26.10.0
}

install_project() {
  python3 -m pip install --no-cache-dir --only-binary=:all: \
    /tmp/hq/packages/data-artifacts \
    /tmp/hq/packages/ml-evaluation
  python3 -m pip install --no-cache-dir --only-binary=:all: \
    /tmp/hq/packages/pathologize-tiler \
    /tmp/hq/ml-pipelines/pathologize-benchmark-contracts
  python3 -m pip install --no-cache-dir --only-binary=:all: \
    /tmp/hq/ml-pipelines/pathologize-tiling-benchmark

  python3 - <<'PY'
from importlib import metadata

import cucim
import cupy
import nvidia.nvimgcodec

assert metadata.version("cucim-cu12") == "26.10.0"
assert metadata.version("cupy-cuda12x") == "14.2.0"
assert metadata.version("nvidia-cuda-runtime-cu12") == "12.9.79"
assert metadata.version("nvidia-cuda-nvrtc-cu12") == "12.9.86"
assert metadata.version("nvidia-nvimgcodec-cu12") == "0.9.0.20"
PY
}

case ${mode} in
  dependencies) install_dependencies ;;
  project) install_project ;;
  all)
    install_dependencies
    install_project
    ;;
  *)
    echo "expected install mode dependencies, project, or all" >&2
    exit 2
    ;;
esac
