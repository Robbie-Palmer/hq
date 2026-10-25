#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/evaluate-punctuation-candidate.ts \
  --evidence data/review-evidence/gector-broad-pilot \
  --deterministic data/review-evidence/deterministic-pilot-post-hardening \
  --experiment punctuation-experiment.json \
  --candidate outputs/punctuation-candidate/run/run.json \
  --output outputs/punctuation-candidate/evaluation.json \
  --report outputs/punctuation-candidate/report.md
