#!/usr/bin/env bash
set -euo pipefail

provider_placeholder="test-only-placeholder"
export CLOUDFLARE_API_TOKEN="$provider_placeholder"
export DOPPLER_TOKEN="$provider_placeholder"
export NEON_API_KEY="$provider_placeholder"
export POSTHOG_API_KEY="$provider_placeholder"
export TFE_TOKEN="$provider_placeholder"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/project-module-stateless-validation.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

legacy_data_dir="$test_root/legacy-data"
current_data_dir="$test_root/current-data"
state_file="$test_root/terraform.tfstate"
plan_file="$test_root/migration.tfplan"

TF_DATA_DIR="$legacy_data_dir" terraform -chdir=tests/stateless-validation/legacy init \
  -backend=false -input=false > /dev/null
TF_DATA_DIR="$legacy_data_dir" terraform -chdir=tests/stateless-validation/legacy apply \
  -auto-approve -input=false -state="$state_file" > /dev/null

initial_addresses="$(TF_DATA_DIR="$legacy_data_dir" terraform \
  -chdir=tests/stateless-validation/legacy state list -state="$state_file")"
expected_initial_addresses=$'module.project.terraform_data.managed_capability[0]\nmodule.project.terraform_data.profile_guard'
if [[ "$initial_addresses" != "$expected_initial_addresses" ]]; then
  printf 'Legacy fixture created unexpected state addresses:\n%s\n' "$initial_addresses" >&2
  exit 1
fi

TF_DATA_DIR="$legacy_data_dir" terraform -chdir=tests/stateless-validation/legacy apply \
  -auto-approve -input=false -state="$state_file" -var cleanup_complete=true > /dev/null

interrupted_addresses="$(TF_DATA_DIR="$legacy_data_dir" terraform \
  -chdir=tests/stateless-validation/legacy state list -state="$state_file")"
if [[ "$interrupted_addresses" != "module.project.terraform_data.profile_guard" ]]; then
  printf 'Interrupted cleanup fixture left unexpected state addresses:\n%s\n' \
    "$interrupted_addresses" >&2
  exit 1
fi

TF_DATA_DIR="$current_data_dir" terraform -chdir=tests/stateless-validation/current init \
  -backend=false -input=false > /dev/null
TF_DATA_DIR="$current_data_dir" terraform -chdir=tests/stateless-validation/current plan \
  -input=false -refresh=false -state="$state_file" -var-file=../empty.tfvars \
  -out="$plan_file" > /dev/null

if ! TF_DATA_DIR="$current_data_dir" terraform -chdir=tests/stateless-validation/current \
  show -json "$plan_file" \
  | jq -e '.resource_changes[] | select(.address == "module.project.terraform_data.profile_guard") | .change.actions == ["forget"]' \
    > /dev/null; then
  echo "The migration plan must forget the legacy validation guard without destroying it." >&2
  exit 1
fi

TF_DATA_DIR="$current_data_dir" terraform -chdir=tests/stateless-validation/current apply \
  -auto-approve -input=false -state="$state_file" "$plan_file" > /dev/null
post_cleanup_addresses="$(TF_DATA_DIR="$current_data_dir" terraform \
  -chdir=tests/stateless-validation/current state list -state="$state_file")"
if [[ -n "$post_cleanup_addresses" ]]; then
  printf 'Migrated cleanup left managed state addresses:\n%s\n' "$post_cleanup_addresses" >&2
  exit 1
fi

assert_plan_failure() {
  local fixture="$1"
  local expected_message="$2"
  local failure_state="$test_root/${fixture%.tfvars}.tfstate"
  local normalized_output
  local output
  local status

  set +e
  output="$(TF_DATA_DIR="$current_data_dir" terraform \
    -chdir=tests/stateless-validation/current plan -input=false -refresh=false \
    -state="$failure_state" -var-file="../$fixture" -no-color 2>&1)"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected $fixture to fail during plan." >&2
    exit 1
  fi
  normalized_output="$(tr '\n' ' ' <<<"$output" | tr -s ' ')"
  if ! grep -Fq "$expected_message" <<<"$normalized_output"; then
    printf 'Plan failure for %s did not contain the expected message.\n' "$fixture" >&2
    exit 1
  fi
}

assert_plan_failure \
  configuration-mismatch.tfvars \
  "Capability configuration must be supplied exactly when selected by the resolved profile. Mismatches: cloudflare_r2."
assert_plan_failure \
  shared-preview-database.tfvars \
  "database.preview-isolation requires a separate Neon preview project."
assert_plan_failure \
  incomplete-worker-route.tfvars \
  "cloudflare_worker zone_id and hostname must be supplied together."
