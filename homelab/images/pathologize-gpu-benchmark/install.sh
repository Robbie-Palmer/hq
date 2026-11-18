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
    --no-build \
    --extra cuda \
    --extra model \
    --no-dev \
    --no-editable \
    --no-install-package data-artifacts \
    --no-install-package ml-evaluation \
    --no-install-package pathologize-benchmark-contracts \
    --no-install-package pathologize-tiler \
    --no-install-package pathologize-tiling-benchmark

local_sync_args=(
  --project /tmp/hq/ml-pipelines/pathologize-tiling-benchmark
  --locked
  --offline
  --extra cuda
  --extra model
  --no-dev
  --no-editable
)
UV_PROJECT_ENVIRONMENT=/opt/pathologize/venv uv sync "${local_sync_args[@]}" # NOSONAR shell:S8541 -- Offline pass builds only the five repository-owned packages skipped above.

/opt/pathologize/venv/bin/python - <<'PY'
import nvidia.nvimgcodec
import cupy

if cupy.cuda.runtime.runtimeGetVersion() < 13000:
    raise RuntimeError("the benchmark image requires CUDA 13.0 or newer")
PY
