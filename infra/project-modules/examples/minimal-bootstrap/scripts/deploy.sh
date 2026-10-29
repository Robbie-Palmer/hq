#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
bash examples/minimal-bootstrap/scripts/doppler-terraform-env.sh apply \
  pnpm --dir "$repository_root/ui" exec wrangler pages deploy \
  "$repository_root/infra/project-modules/examples/minimal-bootstrap/site" \
  --project-name platform-bootstrap-canary \
  --branch bootstrap-canary
