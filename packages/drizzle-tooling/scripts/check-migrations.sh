#!/usr/bin/env bash
set -euo pipefail

migration_dir=${1:-drizzle}
repository_root=$(git rev-parse --show-toplevel)

bash "$repository_root/scripts/check-drizzle-migration-names.sh" "$migration_dir"
pnpm exec drizzle-kit check

before=$(git status --porcelain --untracked-files=all -- "$migration_dir")
pnpm exec drizzle-kit generate --name add_uncommitted_schema_change
after=$(git status --porcelain --untracked-files=all -- "$migration_dir")

if [[ "$before" != "$after" ]]; then
  echo "Schema changes are missing a committed Drizzle migration." >&2
  echo "Review the generated migration, give it a semantic name, and commit it." >&2
  exit 1
fi
