#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx src/build-current-content-corpus.ts \
  --repository ../.. \
  --params current-content-params-strict.json \
  --audience developer \
  --output data/developer-content
