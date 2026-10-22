#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/report-current-content-gector.ts \
  --manifest data/current-content/manifest.json \
  --baseline outputs/current-content/calibration/baseline/run.json \
  --balanced outputs/current-content/calibration/balanced/run.json \
  --strict outputs/current-content/calibration/strict/run.json \
  --full outputs/current-content/full/run.json \
  --output outputs/current-content/report
