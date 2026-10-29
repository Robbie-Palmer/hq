#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
wrapper="examples/minimal-bootstrap/scripts/doppler-terraform-env.sh"
deployment_url="$(
  bash "$wrapper" apply pnpm --dir "$repository_root/ui" exec wrangler pages deployment list \
    --project-name platform-bootstrap-canary \
    --environment production \
    --json \
    | jq -er 'first | .Deployment'
)"

for url in \
  "https://bootstrap-canary.robbiepalmer.me/" \
  "https://platform-bootstrap-canary.pages.dev/" \
  "$deployment_url"; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$url")"
  if [[ "$status" != "302" && "$status" != "403" ]]; then
    echo "Expected Cloudflare Access to reject $url, got HTTP $status" >&2
    exit 1
  fi
done
echo "Cloudflare Access rejected the custom domain, production hostname, and immutable deployment URL."
