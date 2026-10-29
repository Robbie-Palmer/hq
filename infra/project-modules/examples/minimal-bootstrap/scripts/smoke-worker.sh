#!/usr/bin/env bash
set -euo pipefail

response="$(curl --fail --silent --show-error https://bootstrap-canary-worker.robbiepalmer.me/)"
jq -e '
  keys == ["dataClassification", "environment", "project"] and
  .project == "platform-bootstrap-canary" and
  .environment == "preview" and
  .dataClassification == "synthetic-only"
' <<<"$response" >/dev/null
echo "Cloudflare Worker synthetic health smoke passed."
