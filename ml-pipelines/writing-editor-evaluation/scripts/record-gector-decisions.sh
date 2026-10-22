#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/record-gector-decisions.ts \
  --config review-decision-config.json \
  --seed-cohort outputs/frozen/cohort.json \
  --seed-corpus data/corpus \
  --seed-run outputs/producers/gector/run.json \
  --customer-cohort data/review-baseline/customer/cohort.json \
  --customer-corpus data/review-baseline/customer \
  --customer-target data/current-content \
  --customer-run outputs/review-baseline/customer/run.json \
  --developer-cohort data/review-baseline/developer/cohort.json \
  --developer-corpus data/review-baseline/developer \
  --developer-target data/developer-content \
  --developer-run outputs/review-baseline/developer/run.json \
  --output data/review-evidence/gector-broad-pilot
