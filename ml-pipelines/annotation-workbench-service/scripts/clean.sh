#!/usr/bin/env bash
set -euo pipefail

for path in .coverage .pytest_cache .ruff_cache .ty_cache build dist coverage.xml; do
  if [[ -e "$path" ]]; then
    rm -rf -- "$path"
  fi
done
