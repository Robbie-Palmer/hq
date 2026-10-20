#!/usr/bin/env bash
set -euo pipefail

baseline_revision="$(mise exec -- node -e 'process.stdout.write(require("./review-baseline-config.json").baselineRevision)')"

pnpm exec tsx src/build-current-content-corpus.ts \
  --repository ../.. \
  --params current-content-params-strict.json \
  --output data/review-baseline/customer \
  --audience customer \
  --revision "$baseline_revision"

pnpm exec tsx src/build-current-content-corpus.ts \
  --repository ../.. \
  --params current-content-params-strict.json \
  --output data/review-baseline/developer \
  --audience developer \
  --revision "$baseline_revision"
