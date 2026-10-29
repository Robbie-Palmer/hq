#!/usr/bin/env bash
set -euo pipefail

database_url="$(bash examples/minimal-bootstrap/scripts/doppler-terraform-env.sh preview terraform -chdir=examples/minimal-bootstrap/application output -raw preview_database_connection_uri)"
export MINIMAL_BOOTSTRAP_DATABASE_URL="$database_url"
pnpm exec tsx examples/minimal-bootstrap/scripts/smoke-database.ts
unset MINIMAL_BOOTSTRAP_DATABASE_URL
