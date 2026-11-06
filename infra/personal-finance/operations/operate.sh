#!/usr/bin/env bash
set -euo pipefail

project_id="personal-finance-app"
preview_environment="preview-personal-finance"
preview_secret_ref="doppler://personal-finance/preview"
production_environment="production-personal-finance"
production_plan_secret_ref="doppler://personal-finance/ops"
production_apply_secret_ref="doppler://personal-finance/apply"
operations_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
terraform_root="$(dirname "$operations_dir")"
evidence_dir="$operations_dir/evidence"
step_results='[]'
sensitive_temp_files=()

cleanup_sensitive_files() {
  local file
  for file in "${sensitive_temp_files[@]}"; do
    if [[ -f "$file" ]]; then
      chmod u+w "$file"
      : >"$file"
      rm -f "$file"
    fi
  done
}
trap cleanup_sensitive_files EXIT

usage() {
  cat >&2 <<'USAGE'
Usage: operate.sh <command> [argument]

Commands:
  preview-up <pr-number>       Provision, migrate, seed, deploy, and smoke a preview
  preview-cleanup <pr-number>  Remove every resource scoped to a preview
  production-plan             Create a saved Terraform plan and digest
  production-apply            Apply an unchanged reviewed plan, migrate, deploy, and smoke
  production-rollback <ref>   Run the application rollback hook and production smoke check
  backup                      Create and upload an encrypted backup
  restore <drill-id>          Restore into an explicitly declared scratch target
  alert-smoke                 Emit and verify a production-safe synthetic alert
USAGE
  exit 2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_context() {
  local expected_environment="$1"
  local expected_reference="$2"
  require_value OPERATIONS_GITHUB_ENVIRONMENT
  require_value OPERATIONS_SECRET_CONFIG_REF
  if [[ "$OPERATIONS_GITHUB_ENVIRONMENT" != "$expected_environment" ]]; then
    echo "Expected GitHub environment '$expected_environment'." >&2
    exit 1
  fi
  if [[ "$OPERATIONS_SECRET_CONFIG_REF" != "$expected_reference" ]]; then
    echo "Expected redacted secret handoff '$expected_reference'." >&2
    exit 1
  fi
}

require_mutation_token() {
  local expected="$1"
  if [[ "${OPERATIONS_MUTATION_TOKEN:-}" != "$expected" ]]; then
    echo "Refusing provider mutation without OPERATIONS_MUTATION_TOKEN=$expected" >&2
    exit 1
  fi
}

run_age() {
  mise x age@1.3.2 -- age "$@"
}

run_step() {
  local id="$1"
  shift
  local started_at
  local finished_at
  local outcome
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if "$@"; then
    outcome="passed"
  else
    outcome="failed"
  fi
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  step_results="$(jq \
    --arg id "$id" \
    --arg outcome "$outcome" \
    --arg started_at "$started_at" \
    --arg finished_at "$finished_at" \
    '. + [{id: $id, outcome: $outcome, started_at: $started_at, finished_at: $finished_at}]' \
    <<<"$step_results")"
  [[ "$outcome" == "passed" ]]
}

write_evidence() {
  local action="$1"
  local outcome="$2"
  local subject="$3"
  local timestamp
  local revision
  local plan_digest="${PLAN_DIGEST:-}"
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  revision="$(git -C "$terraform_root" rev-parse HEAD)"
  mkdir -p "$evidence_dir"
  local destination="$evidence_dir/${action}-$(date -u +%Y%m%dT%H%M%SZ).json"
  jq -n \
    --arg project "project:$project_id" \
    --arg action "$action" \
    --arg outcome "$outcome" \
    --arg subject "$subject" \
    --arg revision "$revision" \
    --arg timestamp "$timestamp" \
    --arg plan_digest "$plan_digest" \
    --argjson steps "$step_results" \
    '{
      schema_version: 1,
      project: $project,
      action: $action,
      outcome: $outcome,
      subject: $subject,
      revision: $revision,
      recorded_at: $timestamp,
      plan_digest: (if $plan_digest == "" then null else $plan_digest end),
      steps: $steps
    }' >"$destination"
  echo "Rollout evidence: $destination"
}

run_with_evidence() {
  local action="$1"
  local subject="$2"
  shift 2
  if "$@"; then
    write_evidence "$action" "passed" "$subject"
  else
    local status=$?
    write_evidence "$action" "failed" "$subject"
    return "$status"
  fi
}

hook_preview_provision() { mise //infra/personal-finance:preview:provision; }
hook_preview_migrate() { mise //infra/personal-finance:db:migrate:preview; }
hook_preview_seed() { mise //infra/personal-finance:db:seed:preview; }
hook_preview_deploy() { mise //infra/personal-finance:deploy:preview; }
hook_preview_smoke() { mise //infra/personal-finance:smoke:preview; }
hook_preview_telemetry() { mise //infra/personal-finance:smoke:telemetry; }
hook_preview_cleanup() { mise //infra/personal-finance:preview:cleanup; }
hook_production_migrate() { mise //infra/personal-finance:db:migrate:production; }
hook_production_deploy() { mise //infra/personal-finance:deploy:production; }
hook_production_smoke() { mise //infra/personal-finance:smoke:production; }
hook_production_rollback() { mise //infra/personal-finance:rollback:production; }
backup_environment="production-personal-finance-backup"
backup_secret_ref="doppler://personal-finance/backup"
hook_backup_create() { mise //infra/personal-finance:backup:create; }
hook_backup_restore() { mise //infra/personal-finance:restore:drill; }
alert_environment="production-personal-finance-alerting"
alert_secret_ref="doppler://personal-finance/alerts"
hook_alert_smoke() { mise //infra/personal-finance:smoke:alert; }

preview_up() {
  run_step "preview-provision" hook_preview_provision || return
  run_step "preview-migrate" hook_preview_migrate || return
  run_step "preview-seed-synthetic" hook_preview_seed || return
  run_step "preview-deploy" hook_preview_deploy || return
  run_step "preview-smoke-authenticated" hook_preview_smoke || return
  run_step "preview-smoke-telemetry" hook_preview_telemetry || return
}

preview_cleanup() {
  run_step "preview-cleanup" hook_preview_cleanup || return
}

production_plan() {
  require_value TERRAFORM_PLAN_AGE_RECIPIENT
  mkdir -p "$evidence_dir"
  local plan_file="$evidence_dir/production.tfplan"
  local encrypted_plan="$evidence_dir/production.tfplan.age"
  sensitive_temp_files+=("$plan_file")
  run_step "terraform-init" terraform -chdir="$terraform_root" init -input=false || return
  run_step "terraform-plan" terraform -chdir="$terraform_root" plan \
    -input=false -out="$plan_file" || return
  sha256sum "$plan_file" >"$evidence_dir/production.tfplan.sha256"
  PLAN_DIGEST="$(cut -d ' ' -f 1 "$evidence_dir/production.tfplan.sha256")"
  export PLAN_DIGEST
  run_step "encrypt-terraform-plan" run_age \
    --recipient "$TERRAFORM_PLAN_AGE_RECIPIENT" \
    --output "$encrypted_plan" \
    "$plan_file" || return
  : >"$plan_file"
  rm -f "$plan_file"
}

verify_reviewed_plan_digest() {
  local actual="$1"
  local expected="$2"
  if [[ "$actual" != "$expected" ]]; then
    echo "Reviewed Terraform plan digest does not match the saved plan." >&2
    return 1
  fi
}

production_apply() {
  require_value EXPECTED_PLAN_SHA256
  require_value TERRAFORM_PLAN_AGE_IDENTITY
  local encrypted_plan="$evidence_dir/production.tfplan.age"
  local plan_file
  local identity_file
  local actual_digest
  plan_file="$(mktemp "$evidence_dir/production.tfplan.XXXXXX")"
  identity_file="$(mktemp "$evidence_dir/production.tfplan.identity.XXXXXX")"
  sensitive_temp_files+=("$plan_file" "$identity_file")
  chmod 600 "$identity_file"
  printf '%s\n' "$TERRAFORM_PLAN_AGE_IDENTITY" >"$identity_file"
  unset TERRAFORM_PLAN_AGE_IDENTITY
  run_step "decrypt-reviewed-terraform-plan" run_age \
    --decrypt \
    --identity "$identity_file" \
    --output "$plan_file" \
    "$encrypted_plan" || return
  actual_digest="$(sha256sum "$plan_file" | cut -d ' ' -f 1)"
  run_step "verify-reviewed-plan-digest" verify_reviewed_plan_digest \
    "$actual_digest" "$EXPECTED_PLAN_SHA256" || return
  PLAN_DIGEST="$actual_digest"
  export PLAN_DIGEST
  run_step "terraform-apply-reviewed-plan" terraform -chdir="$terraform_root" apply \
    -input=false "$plan_file" || return
  run_step "production-migrate" hook_production_migrate || return
  run_step "production-deploy" hook_production_deploy || return
  run_step "production-smoke" hook_production_smoke || return
}

production_rollback() {
  run_step "production-rollback" hook_production_rollback || return
  run_step "production-smoke-after-rollback" hook_production_smoke || return
}

require_command jq
require_command mise
require_command sha256sum

command_name="${1:-}"
case "$command_name" in
  preview-up)
    [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || usage
    export PR_NUMBER="$2"
    require_context "$preview_environment" "$preview_secret_ref"
    require_mutation_token "preview:$PR_NUMBER"
    run_with_evidence "preview-up" "pr-$PR_NUMBER" preview_up
    ;;
  preview-cleanup)
    [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || usage
    export PR_NUMBER="$2"
    require_context "$preview_environment" "$preview_secret_ref"
    require_mutation_token "preview-cleanup:$PR_NUMBER"
    run_with_evidence "preview-cleanup" "pr-$PR_NUMBER" preview_cleanup
    ;;
  production-plan)
    require_context "$production_environment" "$production_plan_secret_ref"
    run_with_evidence "production-plan" "production" production_plan
    ;;
  production-apply)
    require_context "$production_environment" "$production_apply_secret_ref"
    require_value EXPECTED_PLAN_SHA256
    require_mutation_token "production:$EXPECTED_PLAN_SHA256"
    run_with_evidence "production-apply" "production" production_apply
    ;;
  production-rollback)
    [[ "${2:-}" =~ ^[0-9a-f]{40}$ ]] || usage
    export ROLLBACK_REVISION="$2"
    require_context "$production_environment" "$production_apply_secret_ref"
    require_mutation_token "rollback:$ROLLBACK_REVISION"
    run_with_evidence "production-rollback" "$ROLLBACK_REVISION" production_rollback
    ;;
  backup)
    require_context "$backup_environment" "$backup_secret_ref"
    require_mutation_token "backup"
    run_with_evidence "backup" "production" run_step "backup-create" hook_backup_create
    ;;
  restore)
    [[ "${2:-}" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || usage
    [[ "${RESTORE_TARGET_CLASS:-}" == "scratch" ]] || {
      echo "RESTORE_TARGET_CLASS must be scratch." >&2
      exit 1
    }
    export RESTORE_DRILL_ID="$2"
    require_context "$backup_environment" "$backup_secret_ref"
    require_mutation_token "restore:$RESTORE_DRILL_ID"
    run_with_evidence "restore" "$RESTORE_DRILL_ID" run_step "backup-restore" hook_backup_restore
    ;;
  alert-smoke)
    require_context "$alert_environment" "$alert_secret_ref"
    require_mutation_token "alert-smoke"
    run_with_evidence "alert-smoke" "production" run_step "alert-smoke" hook_alert_smoke
    ;;
  *) usage ;;
esac
