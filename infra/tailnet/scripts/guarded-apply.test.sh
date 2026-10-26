#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$script_dir/guarded-apply.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/tailnet-apply-guard.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
plan_file="$test_dir/reviewed.plan"
touch "$plan_file"

assert_fails_with() {
  local expected="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "Expected failure to contain '$expected'." >&2
    exit 1
  fi
}

assert_fails_with \
  "does not exist" \
  bash "$guard" "$test_dir/missing.plan" true

assert_fails_with \
  "TAILNET_APPLY_CONFIRM" \
  bash "$guard" "$plan_file" true

TAILNET_APPLY_CONFIRM="apply hq-tailnet" \
  bash "$guard" "$plan_file" true
