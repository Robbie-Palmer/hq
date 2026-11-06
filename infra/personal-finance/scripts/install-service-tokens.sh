#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract="$terraform_root/operations/bootstrap-contract.json"
repository="${GITHUB_REPOSITORY:-Robbie-Palmer/hq}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/personal-finance-service-tokens.XXXXXX")"
active_project=""
active_config=""
active_token_name=""

cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 && -n "$active_token_name" ]]; then
    token_slug="$(doppler configs tokens --project "$active_project" --config "$active_config" --json \
      | jq -r --arg name "$active_token_name" '(. // [])[] | select(.name == $name) | .slug // .id // empty' \
      | head -n 1)"
    if [[ -n "$token_slug" ]]; then
      doppler configs tokens revoke "$token_slug" --project "$active_project" --config "$active_config" >/dev/null 2>&1 || true
    fi
  fi
  find "$temp_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$temp_dir" 2>/dev/null || true
  return "$status"
}
trap cleanup EXIT INT TERM

for command_name in doppler gh jq; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

jq -e '.schema_version == 1 and (.configs | length == 6)' "$contract" >/dev/null

while IFS= read -r config; do
  reference="$(jq -r '.reference' <<<"$config")"
  active_project="${reference#doppler://}"
  active_config="${active_project#*/}"
  active_project="${active_project%%/*}"
  github_environment="$(jq -r '.github_environment' <<<"$config")"
  active_token_name="personal-finance-github-${active_config}-$(date -u +%Y%m%dT%H%M%SZ)"
  token_file="$temp_dir/$active_project-$active_config.token"

  if [[ "${PERSONAL_FINANCE_TOKEN_HANDOFF_CHECK_ONLY:-0}" == "1" ]]; then
    echo "Would install a scoped token for $reference in $github_environment."
    active_token_name=""
    continue
  fi

  doppler configs tokens create "$active_token_name" --access read \
    --project "$active_project" --config "$active_config" --plain >"$token_file"
  chmod 600 "$token_file"
  [[ -s "$token_file" ]] || {
    echo "Doppler returned an empty service token for $reference" >&2
    exit 1
  }

  while IFS= read -r secret_name; do
    gh secret set "$secret_name" --env "$github_environment" --repo "$repository" <"$token_file"
  done < <(jq -r '.github_token_secrets[]' <<<"$config")

  current_slug="$(doppler configs tokens --project "$active_project" --config "$active_config" --json \
    | jq -r --arg name "$active_token_name" '(. // [])[] | select(.name == $name) | .slug // .id // empty' \
    | head -n 1)"
  [[ -n "$current_slug" ]] || {
    echo "Could not resolve the created service-token metadata for $reference" >&2
    exit 1
  }

  while IFS= read -r old_slug; do
    [[ -n "$old_slug" && "$old_slug" != "$current_slug" ]] || continue
    doppler configs tokens revoke "$old_slug" --project "$active_project" --config "$active_config" >/dev/null
  done < <(doppler configs tokens --project "$active_project" --config "$active_config" --json \
    | jq -r --arg prefix "personal-finance-github-${active_config}-" \
      '(. // [])[] | select(.name | startswith($prefix)) | .slug // .id // empty')

  : >"$token_file"
  unlink "$token_file"
  echo "Installed the scoped Doppler token for $reference in $github_environment."
  active_token_name=""
done < <(jq -c '.configs[]' "$contract")

echo "Personal Finance config-scoped GitHub token handoff complete."
