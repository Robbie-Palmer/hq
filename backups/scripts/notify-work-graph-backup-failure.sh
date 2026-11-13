#!/usr/bin/env bash
set -euo pipefail

issue_title="Work Graph database backup failed"
run_url="${1:-}"

if [[ ! "$run_url" =~ ^https://github\.com/[^/]+/[^/]+/actions/runs/[0-9]+$ ]]; then
  echo "Expected a GitHub Actions run URL." >&2
  exit 1
fi

existing=$(gh issue list \
  --search "\"${issue_title}\" in:title" \
  --state open \
  --json number,title \
  --jq 'map(select(.title == "Work Graph database backup failed"))[0].number // empty')

body_file=$(mktemp)
cleanup() {
  rm -f "$body_file"
}
trap cleanup EXIT

if [[ -n "$existing" ]]; then
  existing_body=$(gh issue view "$existing" --json body --jq '.body')
  if grep -Fq -- "$run_url" <<<"$existing_body"; then
    echo "Issue #$existing already records this failed run"
    exit 0
  fi

  printf '%s\n- %s\n' "$existing_body" "$run_url" >"$body_file"
  gh issue edit "$existing" --body-file "$body_file"
  echo "Recorded failed run in issue #$existing"
  exit 0
fi

printf '%s\n' \
  'The scheduled encrypted Work Graph database backup failed.' \
  '' \
  'The most recent successful Work Graph R2 backup may now be stale. Please investigate and rerun the workflow.' \
  '' \
  '## Failed workflow runs' \
  '' \
  "- $run_url" >"$body_file"

gh issue create --title "$issue_title" --body-file "$body_file"
