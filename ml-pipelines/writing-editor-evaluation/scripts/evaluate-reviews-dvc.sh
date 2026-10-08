#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/evaluate-reviews.ts \
  --manifest data/review-evidence/repository-pilot/manifest.json \
  --evidence data/review-evidence/repository-pilot \
  --params evaluation-params.json \
  --output outputs/evaluation/repository-pilot.json
