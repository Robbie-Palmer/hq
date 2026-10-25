#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/evaluate-publication-pilot.ts \
  --preregistration publication-pilot.json \
  --evidence data/review-evidence/publication-pilot/evidence.json \
  --evidence-root data/review-evidence/publication-pilot \
  --repository ../.. \
  --output outputs/publication-pilot/report.json \
  --report outputs/publication-pilot/report.md
