#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/evaluate-reviews.ts \
  --manifest evidence/repository-pilot/manifest.json \
  --evidence evidence/repository-pilot \
  --params evaluation-params.json \
  --output outputs/evaluation/repository-pilot.json
