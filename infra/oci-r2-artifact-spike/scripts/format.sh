#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

files=(config/zot.json)
if [[ -f evidence/scorecard.json ]]; then
  files+=(evidence/scorecard.json)
fi
for file in "${files[@]}"; do
  temporary="$(mktemp)"
  jq --indent 2 . "$file" > "$temporary"
  mv "$temporary" "$file"
done
