#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export PIP_BREAK_SYSTEM_PACKAGES=1

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates \
  python3 \
  python3-pip
rm --recursive --force /var/lib/apt/lists/*

python3 -m pip install --no-cache-dir \
  cupy-cuda12x==14.2.0 \
  'cuda-toolkit[cudart,nvrtc]==12.9.2.0'

python3 -m pip install --no-cache-dir \
  /tmp/hq/packages/data-artifacts \
  /tmp/hq/packages/ml-evaluation
python3 -m pip install --no-cache-dir \
  '/tmp/hq/packages/pathologize-tiler[cuda]' \
  /tmp/hq/ml-pipelines/pathologize-benchmark-contracts
python3 -m pip install --no-cache-dir \
  /tmp/hq/ml-pipelines/pathologize-tiling-benchmark

python3 - <<'PY'
import nvidia.nvimgcodec
import cupy

if cupy.cuda.runtime.runtimeGetVersion() < 12010:
    raise RuntimeError("the benchmark image requires CUDA 12.1 or newer")
PY
