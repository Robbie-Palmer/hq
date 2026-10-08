#!/usr/bin/env bash
set -euo pipefail

uv sync --locked --no-dev --no-build
.venv/bin/python python/gector_runtime.py --mode adapter-smoke

pnpm exec tsx src/run-gector.ts \
  --cohort outputs/frozen/cohort.json \
  --corpus data/corpus \
  --model data/models/gector-2024 \
  --manifest model-manifest.json \
  --params params.yaml \
  --raw outputs/smoke/gector-raw.json \
  --artifact grammarly-handoff-adr-vale-pass \
  --output outputs/smoke/gector
