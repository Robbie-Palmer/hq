#!/usr/bin/env bash
set -euo pipefail

cohort_file="$1"
params_file="$2"
output_directory="$3"
corpus_directory="${4:-data/current-content}"

uv sync --locked --no-dev --no-build
.venv/bin/python python/gector_runtime.py \
  --mode cohort \
  --cohort "$cohort_file" \
  --corpus "$corpus_directory" \
  --params "$params_file" \
  --output "$output_directory/raw-inference.json"

pnpm exec tsx src/run-gector.ts \
  --cohort "$cohort_file" \
  --corpus "$corpus_directory" \
  --model data/models/gector-2024 \
  --manifest model-manifest.json \
  --params "$params_file" \
  --raw "$output_directory/raw-inference.json" \
  --output "$output_directory"
