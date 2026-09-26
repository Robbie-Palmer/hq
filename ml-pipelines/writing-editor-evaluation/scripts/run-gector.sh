#!/usr/bin/env bash
set -euo pipefail

uv sync --locked --no-dev --no-build
.venv/bin/python python/gector_runtime.py --mode cohort

pnpm exec tsx src/run-gector.ts \
  --cohort outputs/frozen/cohort.json \
  --corpus data/corpus \
  --model data/models/gector-2024 \
  --manifest model-manifest.json \
  --params params.yaml \
  --raw outputs/producers/gector/raw-inference.json \
  --output outputs/producers/gector
