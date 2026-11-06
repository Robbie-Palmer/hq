#!/usr/bin/env bash
set -euo pipefail

base_revision="${1:?Pass the base Git revision to compare against}"
spec_path="workers/personal-finance-api/openapi.json"
current_spec="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/openapi.json"

if ! git rev-parse --verify --quiet "${base_revision}^{commit}" >/dev/null; then
  echo "Base revision ${base_revision} is unavailable; fetch it before comparing contracts." >&2
  exit 1
fi

if ! git cat-file -e "${base_revision}:${spec_path}" 2>/dev/null; then
  echo "No OpenAPI contract exists at ${base_revision}; skipping the initial baseline diff."
  exit 0
fi

base_spec=$(mktemp "${TMPDIR:-/tmp}/personal-finance-api-openapi-base.XXXXXX.json")
trap 'rm -f "$base_spec"' EXIT
git show "${base_revision}:${spec_path}" > "$base_spec"
oasdiff breaking --fail-on ERR "$base_spec" "$current_spec"
