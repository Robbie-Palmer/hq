#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
notify_script="$script_dir/notify-work-graph-backup-failure.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-backup-notification-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

cat >"$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-} ${2:-}"
case "$operation" in
  "issue list")
    if [[ "${MOCK_ISSUE_EXISTS:-false}" == "true" ]]; then
      printf '%s\n' '77'
    fi
    ;;
  "issue view")
    printf '%s\n' "${MOCK_ISSUE_BODY:-}"
    ;;
  "issue create" | "issue edit")
    while (($# > 0)); do
      if [[ "$1" == "--body-file" ]]; then
        cp "$2" "$MOCK_CAPTURED_BODY"
        break
      fi
      shift
    done
    printf '%s\n' "$operation" >>"$MOCK_OPERATION_LOG"
    ;;
  *)
    echo "Unexpected gh invocation: $*" >&2
    exit 1
    ;;
esac
MOCK_GH
chmod +x "$mock_bin/gh"

operation_log="$test_dir/operations"
captured_body="$test_dir/body"
first_run="https://github.com/Robbie-Palmer/hq/actions/runs/41297587280"
second_run="https://github.com/Robbie-Palmer/hq/actions/runs/42471220801"

: >"$operation_log"
MOCK_CAPTURED_BODY="$captured_body" \
  MOCK_OPERATION_LOG="$operation_log" \
  PATH="$mock_bin:$PATH" \
  bash "$notify_script" "$first_run"
grep -Fxq -- "- $first_run" "$captured_body"
grep -Fxq -- "issue create" "$operation_log"

prior_body=$(printf '%s\n' \
  'The scheduled encrypted Work Graph database backup failed.' \
  '' \
  '## Failed workflow runs' \
  '' \
  "- $first_run")
: >"$operation_log"
MOCK_CAPTURED_BODY="$captured_body" \
  MOCK_ISSUE_BODY="$prior_body" \
  MOCK_ISSUE_EXISTS=true \
  MOCK_OPERATION_LOG="$operation_log" \
  PATH="$mock_bin:$PATH" \
  bash "$notify_script" "$second_run"
grep -Fxq -- "- $first_run" "$captured_body"
grep -Fxq -- "- $second_run" "$captured_body"
grep -Fzq -- "- $first_run
- $second_run" "$captured_body"
grep -Fxq -- "issue edit" "$operation_log"

: >"$operation_log"
MOCK_CAPTURED_BODY="$captured_body" \
  MOCK_ISSUE_BODY="$prior_body" \
  MOCK_ISSUE_EXISTS=true \
  MOCK_OPERATION_LOG="$operation_log" \
  PATH="$mock_bin:$PATH" \
  bash "$notify_script" "$first_run"
if [[ -s "$operation_log" ]]; then
  echo "Duplicate notification mutated the issue." >&2
  exit 1
fi

if MOCK_CAPTURED_BODY="$captured_body" \
  MOCK_OPERATION_LOG="$operation_log" \
  PATH="$mock_bin:$PATH" \
  bash "$notify_script" "https://example.com/not-a-run"; then
  echo "Notification accepted an invalid run URL." >&2
  exit 1
fi

echo "Work Graph backup notification tests passed."
