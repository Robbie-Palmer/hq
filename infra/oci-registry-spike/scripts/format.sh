#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
for config in config/zot.json config/zot-gc.json evidence/scorecard.json; do
  temporary=".$(basename "$config").formatted.tmp"
  jq --indent 2 . "$config" > "$temporary"
  if ! cmp --silent "$config" "$temporary"; then
    mv "$temporary" "$config"
  else
    rm "$temporary"
  fi
done

