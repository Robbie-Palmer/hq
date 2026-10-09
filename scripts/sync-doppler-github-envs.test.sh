#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sync-doppler-github-envs-test.XXXXXX")"
CALLS_FILE="$TEST_DIR/calls"
trap 'find "$TEST_DIR" -depth -delete 2>/dev/null || true' EXIT INT TERM

doppler() {
  jq -n '{
    CLOUDFLARE_ACCOUNT_ID: {
      computed: "test-account",
      computedVisibility: "unmasked"
    },
    GITHUB_ALLOWED_INSTALLATION_IDS: {
      computed: "[123]",
      computedVisibility: "masked"
    },
    GITHUB_ALLOWED_REPOSITORIES: {
      computed: "[\"example/repository\"]",
      computedVisibility: "masked"
    },
    GITHUB_APP_ID: {
      computed: "456",
      computedVisibility: "masked"
    },
    GITHUB_WEBHOOK_SECRET: {
      computed: "test-webhook-secret",
      computedVisibility: "masked"
    }
  }'
}

gh() {
  local resource="$1"
  local operation="$2"
  shift 2
  local name="${1:-}"

  case "$resource $operation" in
    "secret set" | "variable set" | "secret delete" | "variable delete")
      printf '%s %s %s\n' "$resource" "$operation" "$name" >>"$CALLS_FILE"
      ;;
    "secret list")
      printf '%s\n' '[{"name":"OLD_SECRET"}]'
      ;;
    "variable list")
      printf '%s\n' '[{"name":"OLD_VARIABLE"}]'
      ;;
    *)
      printf 'Unexpected gh invocation: %s %s %s\n' "$resource" "$operation" "$*" >&2
      return 1
      ;;
  esac
}

export -f doppler gh
export CALLS_FILE

scripts/sync-doppler-github-envs.sh production-work-graph >/dev/null

expected_calls=(
  "variable set CLOUDFLARE_ACCOUNT_ID"
  "secret set WORK_GRAPH_GITHUB_ALLOWED_INSTALLATION_IDS"
  "secret set WORK_GRAPH_GITHUB_ALLOWED_REPOSITORIES"
  "secret set WORK_GRAPH_GITHUB_APP_ID"
  "secret set WORK_GRAPH_GITHUB_WEBHOOK_SECRET"
  "secret delete OLD_SECRET"
  "variable delete OLD_VARIABLE"
)

for expected_call in "${expected_calls[@]}"; do
  if ! grep -Fxq -- "$expected_call" "$CALLS_FILE"; then
    printf 'Missing expected call: %s\n' "$expected_call" >&2
    exit 1
  fi
done

if grep -Eq '^(secret|variable) set GITHUB_' "$CALLS_FILE"; then
  echo "GitHub-reserved secret name was not aliased" >&2
  exit 1
fi

echo "Doppler to GitHub environment sync tests passed."
