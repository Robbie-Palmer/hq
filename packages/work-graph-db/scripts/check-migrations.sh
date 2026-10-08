#!/usr/bin/env bash
set -euo pipefail

pnpm exec drizzle-kit check

before=$(git status --porcelain --untracked-files=all -- drizzle)
pnpm exec drizzle-kit generate --name uncommitted_schema_change
after=$(git status --porcelain --untracked-files=all -- drizzle)

if [[ "$before" != "$after" ]]; then
  echo "Schema changes are missing a committed Drizzle migration." >&2
  echo "Review the generated migration, rename it if useful, and commit it." >&2
  exit 1
fi
