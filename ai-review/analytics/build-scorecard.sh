#!/usr/bin/env bash
set -euo pipefail

INPUT_PREFIX="${AI_REVIEW_SCORECARD_INPUT:-${1:-}}"
OUTPUT_ROOT="${AI_REVIEW_SCORECARD_OUTPUT:-${2:-}}"
CACHE_ROOT="${AI_REVIEW_SCORECARD_CACHE:-$HOME/.cache/ai-review}"
MART_VERSION="v1"

if [[ -z "$INPUT_PREFIX" && -d "$CACHE_ROOT/r2-export" ]]; then
  INPUT_PREFIX="$CACHE_ROOT/r2-export"
fi
if [[ -z "$OUTPUT_ROOT" ]]; then
  OUTPUT_ROOT="$CACHE_ROOT/marts"
fi

if [[ -z "$INPUT_PREFIX" || -z "$OUTPUT_ROOT" ]]; then
  echo "usage: mise run //ai-review:scorecard:build -- <r2-export-directory> <output-directory>" >&2
  echo "       (paths are relative to ai-review/; or set AI_REVIEW_SCORECARD_INPUT and AI_REVIEW_SCORECARD_OUTPUT)" >&2
  echo "       no input given and no pulled export found at $CACHE_ROOT/r2-export; run: mise run //ai-review:scorecard:pull" >&2
  exit 2
fi
if ! command -v duckdb >/dev/null 2>&1; then
  echo "duckdb is required (run through mise)" >&2
  exit 2
fi

input_files=()
while IFS= read -r -d '' file; do input_files+=("$file"); done < <(find "$INPUT_PREFIX" -type f -name '*.json' -print0 | LC_ALL=C sort -z)
if [[ ${#input_files[@]} -eq 0 ]]; then
  echo "no JSON objects found under $INPUT_PREFIX" >&2
  exit 1
fi

sql_list=""
for file in "${input_files[@]}"; do
  if [[ "$file" == *"'"* || "$file" == *'\'* ]]; then
    echo "input path contains a quote or backslash, which the SQL literal escaping cannot represent safely: $file" >&2
    exit 2
  fi
  [[ -n "$sql_list" ]] && sql_list+=","
  sql_list+="'$file'"
done

mkdir -p "$OUTPUT_ROOT/.scorecard-releases"
work=$(mktemp -d)
link=""
cleanup() {
  rm -rf "$work"
  [[ -z "$link" ]] || rm -f "$link"
}
trap cleanup EXIT

while IFS= read -r line; do
  if [[ "$line" == *"__INPUT_FILES__"* ]]; then
    printf 'FROM read_json_objects([%s], filename = true);\n' "$sql_list"
  else
    printf '%s\n' "$line"
  fi
done < "$(dirname "$0")/scorecard.sql" > "$work/build.sql"
duckdb "$work/scorecard.duckdb" < "$work/build.sql" >/dev/null

publish="$work/$MART_VERSION"
mkdir -p "$publish"
for mart in finding_latest review_path_fact review_run_fact model_run_fact pull_request_fact; do
  duckdb "$work/scorecard.duckdb" \
    "COPY (SELECT * FROM $mart ORDER BY ALL) TO '$publish/$mart.parquet' (FORMAT PARQUET, COMPRESSION uncompressed);"
done

manifest_tmp="$work/manifest.json"
marts=(finding_latest review_path_fact review_run_fact model_run_fact pull_request_fact)
manifest_entries=()
for mart in "${marts[@]}"; do
  checksum=$(shasum -a 256 "$publish/$mart.parquet" | awk '{print $1}')
  rows=$(duckdb -csv -noheader -c "SELECT count(*) FROM read_parquet('$publish/$mart.parquet')")
  manifest_entries+=("$mart" "$mart.parquet" "$rows" "$checksum")
done
if (( ${#manifest_entries[@]} != ${#marts[@]} * 4 )); then
  echo "manifest entry count mismatch" >&2
  exit 1
fi
node -e '
  const fs = require("node:fs");
  const [output, inputPrefix, martVersion, ...values] = process.argv.slice(1);
  const marts = {};
  for (let index = 0; index < values.length; index += 4) {
    marts[values[index]] = {
      path: values[index + 1],
      rows: Number(values[index + 2]),
      sha256: values[index + 3],
    };
  }
  fs.writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, martVersion, inputPrefix, marts }, null, 2)}\n`);
' "$manifest_tmp" "$INPUT_PREFIX" "$MART_VERSION" "${manifest_entries[@]}"
mv "$manifest_tmp" "$publish/scorecard-manifest.json"

# Publish an immutable content-addressed release, then atomically move the
# version symlink so readers see either the complete old or complete new set.
input_digest=$(
  for file in "${input_files[@]}"; do shasum -a 256 "$file"; done |
    LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
)
release_name="$MART_VERSION-$input_digest"
release="$OUTPUT_ROOT/.scorecard-releases/$release_name"
set +e
node -e '
  const fs = require("node:fs");
  try {
    fs.renameSync(process.argv[1], process.argv[2]);
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") process.exit(10);
    throw error;
  }
' "$publish" "$release"
release_status=$?
set -e
if [[ $release_status -eq 10 ]]; then
  [[ -d "$release" ]] || {
    echo "release destination exists but is not a directory: $release" >&2
    exit 1
  }
elif [[ $release_status -ne 0 ]]; then
  exit "$release_status"
fi
link="$OUTPUT_ROOT/.$MART_VERSION-link-$$"
ln -s ".scorecard-releases/$release_name" "$link"
node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
  "$link" "$OUTPUT_ROOT/$MART_VERSION"
link=""
target="$OUTPUT_ROOT/$MART_VERSION"
echo "Built scorecard marts in $target"
