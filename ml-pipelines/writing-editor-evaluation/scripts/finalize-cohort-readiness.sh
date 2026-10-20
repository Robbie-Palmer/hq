#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/finalize-cohort-readiness.ts \
  --cohort outputs/frozen/cohort.json \
  --params params.yaml \
  --manifest data/review-evidence/gector-broad-pilot/manifest.json \
  --evidence data/review-evidence/gector-broad-pilot \
  --outcomes data/review-evidence/gector-broad-pilot/seed-outcomes.json \
  --evaluation-params evaluation-params.json \
  --output-json outputs/frozen/readiness.json \
  --output-markdown outputs/frozen/readiness.md
