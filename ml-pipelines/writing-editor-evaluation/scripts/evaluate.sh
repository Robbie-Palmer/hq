#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/evaluate-reviews.ts \
  --manifest data/review-evidence/gector-broad-pilot/manifest.json \
  --evidence data/review-evidence/gector-broad-pilot \
  --params evaluation-params.json \
  --cohort outputs/frozen/cohort.json \
  --vale outputs/producers/vale.json \
  --matches outputs/matched/vale.json \
  --producer-run outputs/producers/gector/run.json \
  --producer-run outputs/review-baseline/customer/run.json \
  --producer-run outputs/review-baseline/developer/run.json \
  --output outputs/evaluation/scorecard.json
