#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates \
  python3
rm --recursive --force /var/lib/apt/lists/*

UV_PROJECT_ENVIRONMENT=/opt/pathologize/venv \
  uv sync \
    --project /tmp/hq/ml-pipelines/pathologize-tiling-benchmark \
    --locked \
    --extra cuda \
    --extra model \
    --no-dev \
    --no-editable

/opt/pathologize/venv/bin/python - <<'PY'
import nvidia.nvimgcodec
import cupy

if cupy.cuda.runtime.runtimeGetVersion() < 13000:
    raise RuntimeError("the benchmark image requires CUDA 13.0 or newer")
PY
