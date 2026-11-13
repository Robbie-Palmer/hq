#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

output_root="$work_dir/published"
retry_output_root="$work_dir/retry-published"
export WORK_GRAPH_ANALYTICS_DB="$work_dir/work-graph.duckdb"

cd "$project_dir"
early_raw="$work_dir/early-raw/work-state/v1"
mkdir -p "$early_raw/events" "$early_raw/manifests" "$early_raw/scopes"
cp fixtures/raw/work-state/v1/events/1-9.ndjson "$early_raw/events/"
cp fixtures/raw/work-state/v1/manifests/1-9.json "$early_raw/manifests/"
cp fixtures/raw/work-state/v1/scopes/9.json "$early_raw/scopes/"

for version_and_raw in \
  "fixture-v1:$work_dir/early-raw" \
  "fixture-v2:$project_dir/fixtures/raw"; do
  version="${version_and_raw%%:*}"
  raw_root="${version_and_raw#*:}"
  staging_root="$work_dir/staged-$version"
  uv run --locked work-graph-analytics stage "$raw_root" "$staging_root"
  uv run --locked work-graph-analytics prepare "$output_root" "$version"
  uv run --locked dbt build \
    --profiles-dir . \
    --target-path "$work_dir/dbt-target-$version" \
    --vars "{raw_staging_root: '$staging_root', output_root: '$output_root', model_version: '$version', period_start: '2026-10-01T01:00:00Z', period_end: '2026-10-01T03:00:00Z'}"
  uv run --locked work-graph-analytics publish "$output_root" "$version" "$staging_root"
done

staging_root="$work_dir/staged-fixture-v2"
uv run --locked work-graph-analytics prepare "$retry_output_root" fixture-v2
uv run --locked dbt build \
  --profiles-dir . \
  --target-path "$work_dir/dbt-target-fixture-v2-retry" \
  --vars "{raw_staging_root: '$staging_root', output_root: '$retry_output_root', model_version: 'fixture-v2', period_start: '2026-10-01T01:00:00Z', period_end: '2026-10-01T03:00:00Z'}"
uv run --locked work-graph-analytics publish \
  "$retry_output_root" fixture-v2 "$staging_root"

(
  cd "$work_dir"
  uv run --project "$project_dir" --locked python \
    "$project_dir/scripts/assert_fixture.py"
)
