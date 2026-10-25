#!/usr/bin/env bash
set -euo pipefail

uv sync --locked --no-dev --no-build
TORCH_DISABLE_NATIVE_JIT=1 .venv/bin/python python/punctuation_runtime.py \
  --evidence-manifest data/review-evidence/gector-broad-pilot/manifest.json \
  --evidence-root data/review-evidence/gector-broad-pilot \
  --experiment punctuation-experiment.json \
  --model data/models/punctuation-restoration-small \
  --output outputs/punctuation-candidate/run/raw-inference.json

bash scripts/adapt-punctuation-candidate.sh
