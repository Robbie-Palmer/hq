#!/usr/bin/env bash
set -euo pipefail

readonly migration_name_pattern='^[0-9]{4}_(add|allow|backfill|change|create|disable|drop|enable|enforce|make|normalize|rank|reconcile|record|remove|rename|replace|seed|set|simplify|store|track|update|use)_[a-z0-9]+(_[a-z0-9]+)+\.sql$'

migration_directory=${1:-drizzle}

if [[ ! -d "$migration_directory" ]]; then
  echo "Migration directory does not exist: $migration_directory" >&2
  exit 2
fi

shopt -s nullglob
migration_files=("$migration_directory"/*.sql)

if (( ${#migration_files[@]} == 0 )); then
  echo "No Drizzle migrations found in $migration_directory." >&2
  exit 1
fi

invalid_migration_names=()
for migration_file in "${migration_files[@]}"; do
  migration_filename=${migration_file##*/}
  if [[ ! "$migration_filename" =~ $migration_name_pattern ]]; then
    invalid_migration_names+=("$migration_filename")
  fi
done

if (( ${#invalid_migration_names[@]} > 0 )); then
  echo "Drizzle migration names must describe an action and a specific subject:" >&2
  printf '  %s\n' "${invalid_migration_names[@]}" >&2
  echo "Use a name such as add_recipe_notes, not an auto-generated name." >&2
  exit 1
fi
