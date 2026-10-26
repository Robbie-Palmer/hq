#!/usr/bin/env bash
set -euo pipefail

bash ../../scripts/check-drizzle-migration-names.sh drizzle
pnpm exec drizzle-kit check

before=$(git status --porcelain --untracked-files=all -- drizzle)
pnpm exec drizzle-kit generate --name add_uncommitted_schema_change
after=$(git status --porcelain --untracked-files=all -- drizzle)

if [[ "$before" != "$after" ]]; then
  echo "Schema changes are missing a committed Drizzle migration." >&2
  echo "Review the generated migration, give it a semantic name, and commit it." >&2
  exit 1
fi
