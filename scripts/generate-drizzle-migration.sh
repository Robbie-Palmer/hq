#!/usr/bin/env bash
set -euo pipefail

readonly migration_name_pattern='^(add|allow|backfill|change|create|disable|drop|enable|enforce|make|normalize|rank|reconcile|record|remove|rename|replace|seed|set|simplify|store|track|update|use)_[a-z0-9]+(_[a-z0-9]+)+$'

if (( $# == 0 )); then
  echo "A semantic migration name is required." >&2
  echo "Usage: db:generate <action_subject> [drizzle-kit options]" >&2
  echo "Example: db:generate add_recipe_notes" >&2
  exit 2
fi

migration_name=$1
shift

if [[ ! "$migration_name" =~ $migration_name_pattern ]]; then
  echo "Invalid migration name: $migration_name" >&2
  echo "Use lowercase snake_case with an action and a specific subject." >&2
  echo "Example: add_recipe_notes" >&2
  exit 2
fi

for generate_argument in "$@"; do
  if [[ "$generate_argument" == "--name" || "$generate_argument" == --name=* ]]; then
    echo "Pass the migration name as the first argument, not with --name." >&2
    exit 2
  fi
done

exec pnpm exec drizzle-kit generate --name "$migration_name" "$@"
