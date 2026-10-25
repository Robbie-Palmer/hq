#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/run-punctuation-candidate.ts \
  --evidence data/review-evidence/gector-broad-pilot \
  --manifest punctuation-model-manifest.json \
  --experiment punctuation-experiment.json \
  --model data/models/punctuation-restoration-small \
  --raw outputs/punctuation-candidate/run/raw-inference.json \
  --output outputs/punctuation-candidate/run/run.json
