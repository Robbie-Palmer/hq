#!/usr/bin/env bash
set -euo pipefail

operations_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract="$operations_root/operations/bootstrap-contract.json"

fail() {
  echo "Personal Finance bootstrap check failed: $*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command '$command_name'"
}

validate_contract() {
  jq -e '
    .schema_version == 1
    and .project == "project:personal-finance-app"
    and .operations_readiness_variable == "PERSONAL_FINANCE_OPERATIONS_READY"
    and .readiness_variable == "PERSONAL_FINANCE_TERRAFORM_READY"
    and (.configs | length == 6)
    and ([.configs[].reference] | unique | length == 6)
    and ([.configs[].github_environment] | unique | length == 6)
    and all(.configs[];
      (.reference | test("^doppler://[a-z0-9-]+/[a-z0-9_]+$"))
      and (.github_environment | test("^[a-z0-9-]+$"))
      and (.github_token_secrets | type == "array" and length > 0)
      and all(.github_token_secrets[]; test("^[A-Z][A-Z0-9_]+$"))
      and ((.github_token_secrets | unique | length) == (.github_token_secrets | length))
      and (.required | type == "array" and length > 0)
      and all(.required[]; test("^[A-Z][A-Z0-9_]*$"))
      and ((.required | unique | length) == (.required | length))
      and ((.external_custody // []) | all(.[]; test("^[A-Z][A-Z0-9_]*$")))
      and ((.post_deploy // []) | all(.[]; test("^[A-Z][A-Z0-9_]*$")))
    )
    and ([.configs[].required[]] | index("PERSONAL_FINANCE_OPERATIONS_READY") | not)
    and ([.configs[].required[]] | index("PERSONAL_FINANCE_TERRAFORM_READY") | not)
  ' "$contract" >/dev/null || fail "invalid redacted contract"
}

check_runtime() {
  local reference="${OPERATIONS_SECRET_CONFIG_REF:-}"
  [[ -n "$reference" ]] || fail "OPERATIONS_SECRET_CONFIG_REF is required"

  local config_count
  config_count="$(jq --arg reference "$reference" '[.configs[] | select(.reference == $reference)] | length' "$contract")"
  [[ "$config_count" == "1" ]] || fail "unknown or duplicate config reference '$reference'"

  local missing=()
  local name
  while IFS= read -r name; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done < <(jq -r --arg reference "$reference" '.configs[] | select(.reference == $reference) | .required[]' "$contract")

  if ((${#missing[@]} > 0)); then
    printf 'Personal Finance bootstrap check failed: missing names for %s: %s\n' \
      "$reference" "${missing[*]}" >&2
    exit 1
  fi

  echo "Bootstrap names present for $reference. Values were not printed."
}

require_command jq
[[ -f "$contract" ]] || fail "contract is missing"
validate_contract

case "${1:-}" in
  contract)
    echo "Personal Finance bootstrap contract is valid and contains no values."
    ;;
  runtime)
    check_runtime
    ;;
  *)
    echo "Usage: check-bootstrap.sh <contract|runtime>" >&2
    exit 2
    ;;
esac
