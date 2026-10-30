#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
output=$(mktemp -d)
second=$(mktemp -d)
bad=$(mktemp -d)
special=$(mktemp -d)
duplicate=$(mktemp -d)
concurrent=$(mktemp -d)
invalid_outcome=$(mktemp -d)
invalid_manifest=$(mktemp -d)
trap 'rm -rf "$output" "$second" "$bad" "$special" "$duplicate" "$concurrent" "$invalid_outcome" "$invalid_manifest"' EXIT

"$here/build-scorecard.sh" "$here/fixtures" "$output"
"$here/build-scorecard.sh" "$here/fixtures" "$second"
"$here/build-scorecard.sh" "$here/fixtures" "$output"

[[ -L "$output/v1" ]]

for file in finding_latest.parquet review_path_fact.parquet review_run_fact.parquet model_run_fact.parquet pull_request_fact.parquet scorecard-manifest.json; do
  cmp "$output/v1/$file" "$second/v1/$file"
done

duckdb -csv -noheader <<SQL | diff -u - <(printf '0.5,0.3333333333333333,0.3333333333333333,0.3,0.75\n')
SELECT acceptance_rate, fix_through_rate, noise_rate, cost_per_accepted_finding, coverage_rate
FROM read_parquet('$output/v1/review_run_fact.parquet') WHERE run_id = 'run-1';
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf 'api/auth.ts,completed,review-completed\napi/route.ts,waived,review-waived-prior-coverage\n')
SELECT path, decision, reason_code
FROM read_parquet('$output/v1/review_path_fact.parquet')
WHERE run_id = 'run-1' ORDER BY path;
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf '2,0,1,0,1,1.0\n')
SELECT manifest_path_count, selected_path_count, completed_path_count,
       failed_path_count, waived_path_count, path_accounting_rate
FROM read_parquet('$output/v1/review_run_fact.parquet') WHERE run_id = 'run-1';
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf 'published,1\n')
SELECT status, count(*)
FROM read_parquet('$output/v1/review_run_fact.parquet')
WHERE run_id = 'run-1'
GROUP BY status;
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf '1.0\n')
SELECT coverage_rate
FROM read_parquet('$output/v1/review_run_fact.parquet') WHERE run_id = 'run-2';
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf 'prompt-1,NULL,NULL,NULL,NULL,1.0,NULL,NULL,false\n')
SELECT prompt_version, publication_policy_version, change_size, change_size_band, coverage_rate,
       published_finding_count, accepted_finding_count, acceptance_rate, finding_identity_available
FROM read_parquet('$output/v1/review_run_fact.parquet') WHERE run_id = 'run-0';
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf 'superseded,censored,false,false,false,false\n')
SELECT outcome, outcome_kind, accepted, fixed, rejected, no_response
FROM read_parquet('$output/v1/finding_latest.parquet') WHERE finding_id = 'f_superseded';
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf '7,4.0,1.0,true\n8,1.0,NULL,false\n')
SELECT pull_request_number, published_finding_count, accepted_finding_count, finding_identity_available
FROM read_parquet('$output/v1/pull_request_fact.parquet') ORDER BY pull_request_number;
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf '2,true,true,1,1\n')
SELECT array_length(prompt_versions), list_contains(prompt_versions, 'prompt-2'),
       list_contains(prompt_versions, 'prompt-3'), array_length(task_types),
       array_length(originating_agents)
FROM read_parquet('$output/v1/pull_request_fact.parquet') WHERE pull_request_number = 7;
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf '[prompt-1],[1],false\n')
SELECT prompt_versions, record_schema_versions, finding_identity_available
FROM read_parquet('$output/v1/pull_request_fact.parquet') WHERE pull_request_number = 8;
SQL

duckdb -csv -noheader <<SQL | diff -u - <(printf 'model-a,700,NULL,0.125\nmodel-a,800,1250.0,0.2\n')
SELECT model, uncached_input_tokens, accepted_findings_per_million_uncached_tokens, cache_hit_rate
FROM read_parquet('$output/v1/model_run_fact.parquet')
WHERE run_id IN ('run-0', 'run-1') ORDER BY run_id;
SQL

"$here/build-scorecard.sh" "$here/fixtures" "$concurrent/output" >"$concurrent/first.log" 2>&1 &
first_pid=$!
"$here/build-scorecard.sh" "$here/fixtures" "$concurrent/output" >"$concurrent/second.log" 2>&1 &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
[[ $(find "$concurrent/output/.scorecard-releases" -mindepth 1 -maxdepth 1 -type d | wc -l) -eq 1 ]]
if find "$concurrent/output/.scorecard-releases" -mindepth 2 -maxdepth 2 -type d -name v1 | grep -q .; then
  echo "concurrent builder nested a release inside the winning release" >&2
  exit 1
fi

special_input="$special/"$'input\'\'&pipe|"\\\nline'
mkdir "$special_input"
cp -R "$here/fixtures/." "$special_input/"
if special_error=$("$here/build-scorecard.sh" "$special_input" "$special/output" 2>&1); then
  echo "input path with a quote was not rejected" >&2
  exit 1
fi
if [[ "$special_error" != *"cannot represent safely"* ]]; then
  echo "special input path failed for the wrong reason: $special_input_error" >&2
  exit 1
fi

cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$bad/good.json"
printf '{"schemaVersion":99,"recordType":"review-run-terminal"}\n' > "$bad/unknown.json"
if schema_error=$("$here/build-scorecard.sh" "$bad" "$bad/output" 2>&1); then
  echo "unknown schema version was not rejected" >&2
  exit 1
fi
if [[ "$schema_error" != *"Unknown schema version"* ]]; then
  echo "unknown schema version failed for the wrong reason: $schema_error" >&2
  exit 1
fi

mkdir -p "$duplicate/a" "$duplicate/b"
cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$duplicate/a/published.json"
cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$duplicate/b/published.json"
if duplicate_error=$("$here/build-scorecard.sh" "$duplicate" "$duplicate/output" 2>&1); then
  echo "duplicate terminal status was not rejected" >&2
  exit 1
fi
if [[ "$duplicate_error" != *"conflicting or duplicate terminal records"* ]]; then
  echo "duplicate terminal status failed for the wrong reason: $duplicate_error" >&2
  exit 1
fi

mkdir -p "$invalid_outcome/null" "$invalid_outcome/unknown" "$invalid_outcome/basis-mismatch"
cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$invalid_outcome/null/published.json"
cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$invalid_outcome/unknown/published.json"
cp "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" "$invalid_outcome/basis-mismatch/published.json"
jq '.outcome = null' "$here/fixtures/v2/acme/widgets/pr-7/findings/f_fixed/outcomes/v1.json" > "$invalid_outcome/null/outcome.json"
jq '.outcome = "invented"' "$here/fixtures/v2/acme/widgets/pr-7/findings/f_fixed/outcomes/v1.json" > "$invalid_outcome/unknown/outcome.json"
jq '.outcome = "superseded" | .outcomeKind = "censored" | .basis = "outcome-window"' "$here/fixtures/v2/acme/widgets/pr-7/findings/f_fixed/outcomes/v1.json" > "$invalid_outcome/basis-mismatch/outcome.json"
for invalid in null unknown basis-mismatch; do
  if outcome_error=$("$here/build-scorecard.sh" "$invalid_outcome/$invalid" "$invalid_outcome/$invalid-output" 2>&1); then
    echo "$invalid outcome was not rejected" >&2
    exit 1
  fi
  if [[ "$outcome_error" != *"Outcome revisions have missing or invalid required fields"* ]]; then
    echo "$invalid outcome failed for the wrong reason: $outcome_error" >&2
    exit 1
  fi
done

mkdir -p "$invalid_manifest/reason" "$invalid_manifest/count"
jq '.coverageManifest.paths[0].reasonCode = "default-included"' \
  "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" \
  > "$invalid_manifest/reason/published.json"
jq '.change.changedFiles = 3' \
  "$here/fixtures/v2/acme/widgets/pr-7/head-1/run-1/published.json" \
  > "$invalid_manifest/count/published.json"
if manifest_error=$("$here/build-scorecard.sh" "$invalid_manifest/reason" "$invalid_manifest/reason-output" 2>&1); then
  echo "invalid manifest reason was not rejected" >&2
  exit 1
fi
if [[ "$manifest_error" != *"missing or invalid decisions"* ]]; then
  echo "invalid manifest reason failed for the wrong reason: $manifest_error" >&2
  exit 1
fi
if manifest_error=$("$here/build-scorecard.sh" "$invalid_manifest/count" "$invalid_manifest/count-output" 2>&1); then
  echo "incomplete manifest was not rejected" >&2
  exit 1
fi
if [[ "$manifest_error" != *"do not account for every changed path"* ]]; then
  echo "incomplete manifest failed for the wrong reason: $manifest_error" >&2
  exit 1
fi

echo "Scorecard fixture tests passed"
