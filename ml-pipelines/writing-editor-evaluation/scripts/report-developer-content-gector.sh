#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/report-current-content-gector.ts \
  --manifest data/developer-content/manifest.json \
  --baseline outputs/developer-content/calibration/baseline/run.json \
  --balanced outputs/developer-content/calibration/balanced/run.json \
  --strict outputs/developer-content/calibration/strict/run.json \
  --full outputs/developer-content/full/run.json \
  --output outputs/developer-content/report
