#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

staging_root="$work_dir/staged"
output_root="$work_dir/published"
export WORK_GRAPH_ANALYTICS_DB="$work_dir/work-graph.duckdb"

cd "$project_dir"
uv run --locked work-graph-analytics stage fixtures/raw "$staging_root"

for version in fixture-v1 fixture-v2; do
  uv run --locked work-graph-analytics prepare "$output_root" "$version"
  uv run --locked dbt build \
    --profiles-dir . \
    --target-path "$work_dir/dbt-target-$version" \
    --vars "{raw_staging_root: '$staging_root', output_root: '$output_root', model_version: '$version', period_start: '2026-10-01T01:00:00Z', period_end: '2026-10-01T03:00:00Z'}"
  uv run --locked work-graph-analytics publish "$output_root" "$version" "$staging_root"
done

uv run --locked python scripts/assert_fixture.py \
  "$output_root/fixture-v1" \
  "$output_root/fixture-v2"
