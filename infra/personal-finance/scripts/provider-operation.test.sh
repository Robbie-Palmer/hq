#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
provider="$script_dir/provider-operation.sh"
bootstrap="$script_dir/check-bootstrap.sh"
token_handoff="$script_dir/install-service-tokens.sh"
contract="$script_dir/../operations/bootstrap-contract.json"
repository_root="$(cd "$script_dir/../../.." && pwd)"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/personal-finance-operation-test.XXXXXX")"
preview_context="$script_dir/../operations/runtime/pr-42.json"
trap '[[ ! -f "$preview_context" ]] || unlink "$preview_context"; find "$temp_dir" -type f -exec unlink {} + 2>/dev/null || true; find "$temp_dir" -depth -type d -exec rmdir {} + 2>/dev/null || true' EXIT

fail() {
  echo "provider-operation.test.sh: $*" >&2
  exit 1
}

assert_fails() {
  if "$@" >"$temp_dir/stdout" 2>"$temp_dir/stderr"; then
    fail "expected command to fail: $*"
  fi
}

assert_succeeds() {
  if ! "$@" >"$temp_dir/stdout" 2>"$temp_dir/stderr"; then
    cat "$temp_dir/stderr" >&2
    fail "expected command to pass: $*"
  fi
}

assert_succeeds bash "$bootstrap" contract
jq -e 'has("values") | not' "$contract" >/dev/null
jq -e 'all(.configs[]; has("required") and (has("secrets") | not))' "$contract" >/dev/null

check_only_bin="$temp_dir/check-only-bin"
mkdir "$check_only_bin"
for command_name in bash dirname find jq mktemp rmdir unlink; do
  ln -s "$(command -v "$command_name")" "$check_only_bin/$command_name"
done
assert_succeeds env PATH="$check_only_bin" PERSONAL_FINANCE_TOKEN_HANDOFF_CHECK_ONLY=1 \
  bash "$token_handoff"
[[ "$(grep -c '^Would install a scoped token' "$temp_dir/stdout")" == "6" ]] \
  || fail "service-token handoff did not cover all six configs"

workflow_root="$repository_root/.github/workflows"
grep -Fq "production-personal-finance-plan" "$workflow_root/personal-finance-operations-production.yml"
grep -Fq 'secrets.PROJECT_PRODUCTION_PLAN_DOPPLER_TOKEN' "$workflow_root/personal-finance-operations-production.yml"
grep -Fq 'secrets.PROJECT_PRODUCTION_APPLY_DOPPLER_TOKEN' "$workflow_root/personal-finance-operations-production.yml"
grep -Fq 'secrets.PROJECT_PREVIEW_DOPPLER_TOKEN' "$workflow_root/personal-finance-operations-preview.yml"
grep -Fq 'secrets.PROJECT_BACKUP_DOPPLER_TOKEN' "$workflow_root/personal-finance-operations-backup.yml"
grep -Fq 'secrets.PROJECT_ALERT_DOPPLER_TOKEN' "$workflow_root/personal-finance-operations-alert.yml"
grep -Fq "PERSONAL_FINANCE_OPERATIONS_READY" "$workflow_root/personal-finance-operations-preview.yml"
if grep -Fq "action: restore" "$workflow_root/personal-finance-operations-backup.yml"; then
  fail "scheduled backup workflow must not receive restore-key custody"
fi
for workflow in personal-finance-infra-ci.yml personal-finance-infra.yml personal-finance-drift.yml; do
  grep -Fq 'DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}' "$workflow_root/$workflow"
done

assert_fails env OPERATIONS_SECRET_CONFIG_REF=doppler://personal-finance/ops \
  TERRAFORM_PLAN_AGE_RECIPIENT=sentinel-secret bash "$bootstrap" runtime
grep -Fq "TF_API_TOKEN" "$temp_dir/stderr"
if grep -Fq "sentinel-secret" "$temp_dir/stdout" "$temp_dir/stderr"; then
  fail "bootstrap check printed a supplied value"
fi

mapfile -t plan_names < <(jq -r '.configs[] | select(.reference == "doppler://personal-finance/ops") | .required[]' "$contract")
plan_environment=(OPERATIONS_SECRET_CONFIG_REF=doppler://personal-finance/ops)
for name in "${plan_names[@]}"; do
  plan_environment+=("$name=sentinel-secret")
done
assert_succeeds env "${plan_environment[@]}" bash "$bootstrap" runtime
if grep -Fq "sentinel-secret" "$temp_dir/stdout" "$temp_dir/stderr"; then
  fail "successful bootstrap check printed a supplied value"
fi

common_preview=(
  PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1
  PR_NUMBER=42
  BETTER_AUTH_SECRET=sentinel-secret
  CANARY_PREVIEW_AUTH_TOKEN=sentinel-secret
  CF_ACCESS_CLIENT_ID=sentinel-secret
  CF_ACCESS_CLIENT_SECRET=sentinel-secret
  CF_ACCESS_SERVICE_TOKEN_ID=sentinel-id
  CLOUDFLARE_ACCOUNT_ID=sentinel-id
  CLOUDFLARE_API_TOKEN=sentinel-secret
  CLOUDFLARE_WORKERS_SUBDOMAIN=example
  GOOGLE_CLIENT_ID=sentinel-id
  GOOGLE_CLIENT_SECRET=sentinel-secret
  NEON_API_KEY=sentinel-secret
  PERSONAL_FINANCE_DATABASE_NAME=personal_finance
  PERSONAL_FINANCE_DATABASE_ROLE=personal_finance_owner
  PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID=sentinel-id
  POSTHOG_HOST=https://example.invalid
  POSTHOG_PERSONAL_API_KEY=sentinel-secret
  POSTHOG_PROJECT_ID=1
  POSTHOG_WRITE_KEY=sentinel-secret
)

for operation in preview-provision preview-migrate preview-seed preview-deploy preview-smoke preview-telemetry preview-cleanup; do
  assert_succeeds env "${common_preview[@]}" bash "$provider" "$operation"
  if grep -Fq "sentinel-secret" "$temp_dir/stdout" "$temp_dir/stderr"; then
    fail "$operation printed a supplied value"
  fi
done

assert_fails env "${common_preview[@]}" PR_NUMBER=0 bash "$provider" preview-provision
grep -Fq "positive integer" "$temp_dir/stderr"

fake_api_bin="$temp_dir/fake-api-bin"
fake_branch_request="$temp_dir/branch-request.json"
mkdir "$fake_api_bin"
cat >"$fake_api_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

output=""
request="GET"
url=""
data_binary=""
write_out=""
status="200"
while (($# > 0)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    --request)
      request="$2"
      shift 2
      ;;
    --url)
      url="$2"
      shift 2
      ;;
    --data-binary)
      data_binary="$2"
      shift 2
      ;;
    --write-out)
      write_out="$2"
      shift 2
      ;;
    --config | --connect-timeout | --max-time | --header | --data | --data-urlencode)
      shift 2
      ;;
    --disable | --fail | --silent | --show-error | --get)
      shift
      ;;
    *)
      echo "Unexpected fake curl argument: $1" >&2
      exit 2
      ;;
  esac
done

[[ -n "$output" && -n "$url" ]]
if [[ "$request" == "GET" && "$url" == */branches ]]; then
  printf '%s\n' '{"branches":[]}' >"$output"
elif [[ "$request" == "POST" && "$url" == */branches ]]; then
  cp "${data_binary#@}" "$FAKE_BRANCH_REQUEST"
  printf '%s\n' '{"branch":{"id":"br-preview"}}' >"$output"
elif [[ "$request" == "GET" && "$url" == */connection_uri ]]; then
  printf '%s\n' '{"uri":"postgresql://preview.invalid/database"}' >"$output"
elif [[ "$request" == "GET" && "$url" == */access/apps ]]; then
  printf '%s\n' '{"success":true,"result":[]}' >"$output"
elif [[ "$request" == "POST" && "$url" == */access/apps ]]; then
  printf '%s\n' '{"success":true,"result":{"id":"app-preview","aud":"aud-preview"}}' >"$output"
elif [[ "$request" == "GET" && "$url" == */access/apps/app-preview/policies ]]; then
  printf '%s\n' '{"success":true,"result":[]}' >"$output"
elif [[ "$request" == "POST" && "$url" == */access/apps/app-preview/policies ]]; then
  printf '%s\n' '{"success":true,"result":{"id":"policy-preview"}}' >"$output"
elif [[ "$request" == "GET" && "$url" == */health ]]; then
  attempts="$(cat "$FAKE_HEALTH_ATTEMPTS" 2>/dev/null || printf '0')"
  attempts="$((attempts + 1))"
  printf '%s\n' "$attempts" >"$FAKE_HEALTH_ATTEMPTS"
  if ((attempts < 3)); then
    status="404"
    printf '%s\n' '{}' >"$output"
  else
    printf '%s\n' '{"status":"ok"}' >"$output"
  fi
elif [[ "$request" == "PUT" && "$url" == */api/canary/household ]]; then
  printf '%s\n' '{"id":"synthetic-household-preview-canary","classification":"synthetic-only","label":"synthetic household"}' >"$output"
elif [[ "$request" == "GET" && "$url" == */api/canary/household ]]; then
  printf '%s\n' '{"id":"synthetic-household-preview-canary","classification":"synthetic-only","label":"synthetic household"}' >"$output"
elif [[ "$request" == "POST" && "$url" == */capture/ ]]; then
  printf '%s\n' '{}' >"$output"
else
  echo "Unexpected fake curl request: $request $url" >&2
  exit 2
fi
if [[ -n "$write_out" ]]; then
  [[ "$write_out" == '%{http_code}' ]]
  printf '%s' "$status"
fi
EOF
chmod 700 "$fake_api_bin/curl"
cat >"$fake_api_bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 700 "$fake_api_bin/sleep"
cat >"$fake_api_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

env_file=""
for argument in "$@"; do
  [[ "$argument" != *"postgresql://"* ]] || {
    echo "Database URL leaked into Docker arguments" >&2
    exit 2
  }
done
while (($# > 0)); do
  case "$1" in
    --env-file)
      env_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
[[ -n "$env_file" && -f "$env_file" ]]
grep -Fqx 'DATABASE_URL=postgresql://preview.invalid/database' "$env_file"
printf '%s\n' invoked >"$FAKE_DOCKER_LOG"
EOF
chmod 700 "$fake_api_bin/docker"

assert_succeeds env "${common_preview[@]}" PERSONAL_FINANCE_OPERATION_CHECK_ONLY=0 \
  PATH="$fake_api_bin:$PATH" FAKE_BRANCH_REQUEST="$fake_branch_request" \
  bash "$provider" preview-provision
jq -e '
  .branch.name == "pr-42"
  and .endpoints == [{"type": "read_write"}]
' "$fake_branch_request" >/dev/null
[[ -f "$preview_context" ]] || fail "preview provision did not write its runtime context"
fake_docker_log="$temp_dir/docker.log"
assert_succeeds env "${common_preview[@]}" PERSONAL_FINANCE_OPERATION_CHECK_ONLY=0 \
  PATH="$fake_api_bin:$PATH" FAKE_DOCKER_LOG="$fake_docker_log" \
  bash "$provider" preview-seed
grep -Fqx invoked "$fake_docker_log"
fake_health_attempts="$temp_dir/health-attempts"
assert_succeeds env "${common_preview[@]}" PERSONAL_FINANCE_OPERATION_CHECK_ONLY=0 \
  PATH="$fake_api_bin:$PATH" FAKE_HEALTH_ATTEMPTS="$fake_health_attempts" \
  bash "$provider" preview-smoke
grep -Fqx 3 "$fake_health_attempts"
unlink "$preview_context"

common_production=(
  PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1
  BETTER_AUTH_SECRET=sentinel-secret
  CLOUDFLARE_ACCOUNT_ID=sentinel-id
  CLOUDFLARE_API_TOKEN=sentinel-secret
  GOOGLE_CLIENT_ID=sentinel-id
  GOOGLE_CLIENT_SECRET=sentinel-secret
  PERSONAL_FINANCE_HYPERDRIVE_ID=sentinel-id
  PERSONAL_FINANCE_PRODUCTION_URL=https://example.invalid
  PRODUCTION_DATABASE_URL=postgresql://production.invalid/database
)

for operation in production-migrate production-deploy production-smoke; do
  assert_succeeds env "${common_production[@]}" bash "$provider" "$operation"
done

revision="0123456789abcdef0123456789abcdef01234567"
assert_succeeds env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  PERSONAL_FINANCE_ROLLBACK_GIT_REVISION="$revision" \
  PERSONAL_FINANCE_ROLLBACK_VERSION_ID=sentinel-version ROLLBACK_REVISION="$revision" \
  bash "$provider" production-rollback
assert_fails env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  PERSONAL_FINANCE_ROLLBACK_GIT_REVISION="$revision" \
  PERSONAL_FINANCE_ROLLBACK_VERSION_ID=sentinel-version ROLLBACK_REVISION="${revision%?}8" \
  bash "$provider" production-rollback
grep -Fq "does not match" "$temp_dir/stderr"

assert_succeeds env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  AGE_RECIPIENT=age1example CLOUDFLARE_ACCOUNT_ID=sentinel-id \
  NEON_DATABASE_URL_UNPOOLED=postgresql://production.invalid/database \
  R2_ACCESS_KEY_ID=sentinel-secret R2_DATABASE_BACKUPS_BUCKET_NAME=example-backups \
  R2_SECRET_ACCESS_KEY=sentinel-secret bash "$provider" backup-create

printf '%s\n' 'AGE-SECRET-KEY-TEST' >"$temp_dir/identity.txt"
chmod 600 "$temp_dir/identity.txt"
assert_succeeds env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  AGE_IDENTITY_FILE="$temp_dir/identity.txt" CLOUDFLARE_ACCOUNT_ID=sentinel-id \
  NEON_DATABASE_URL_UNPOOLED=postgresql://production.invalid/database \
  R2_ACCESS_KEY_ID=sentinel-secret R2_DATABASE_BACKUPS_BUCKET_NAME=example-backups \
  R2_SECRET_ACCESS_KEY=sentinel-secret RESTORE_DATABASE_URL=postgresql://scratch.invalid/database \
  RESTORE_DRILL_ID=drill-1 RESTORE_OBJECT_KEY=weekly/example.dump.age \
  RESTORE_TARGET_CLASS=scratch bash "$provider" restore-drill

assert_fails env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  AGE_IDENTITY_FILE="$temp_dir/identity.txt" CLOUDFLARE_ACCOUNT_ID=sentinel-id \
  NEON_DATABASE_URL_UNPOOLED=postgresql://same.invalid/database \
  R2_ACCESS_KEY_ID=sentinel-secret R2_DATABASE_BACKUPS_BUCKET_NAME=example-backups \
  R2_SECRET_ACCESS_KEY=sentinel-secret RESTORE_DATABASE_URL=postgresql://same.invalid/database \
  RESTORE_DRILL_ID=drill-1 RESTORE_OBJECT_KEY=weekly/example.dump.age \
  RESTORE_TARGET_CLASS=scratch bash "$provider" restore-drill
grep -Fq "differ from production" "$temp_dir/stderr"

assert_succeeds env PERSONAL_FINANCE_OPERATION_CHECK_ONLY=1 \
  POSTHOG_HOST=https://example.invalid POSTHOG_PERSONAL_API_KEY=sentinel-secret \
  POSTHOG_PROJECT_ID=1 POSTHOG_WRITE_KEY=sentinel-secret bash "$provider" alert-smoke

echo "Personal Finance provider operation boundary tests passed."
