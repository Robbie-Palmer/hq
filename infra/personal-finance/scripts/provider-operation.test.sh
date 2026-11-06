#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
provider="$script_dir/provider-operation.sh"
bootstrap="$script_dir/check-bootstrap.sh"
token_handoff="$script_dir/install-service-tokens.sh"
contract="$script_dir/../operations/bootstrap-contract.json"
repository_root="$(cd "$script_dir/../../.." && pwd)"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/personal-finance-operation-test.XXXXXX")"
trap 'find "$temp_dir" -type f -exec unlink {} + 2>/dev/null || true; rmdir "$temp_dir" 2>/dev/null || true' EXIT

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
