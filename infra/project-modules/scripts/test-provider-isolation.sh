#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
test_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/project-modules-provider-isolation.XXXXXX")"
trap 'rm -rf "$test_data_dir"' EXIT

render_fixture() {
  local fixture="$1"
  local root_name="$2"
  local render_dir="$test_data_dir/$fixture"
  mkdir -p "$render_dir/infra"
  ln -s "$repository_root/infra/project-modules" "$render_dir/infra/project-modules"
  copier copy \
    --quiet \
    --defaults \
    --skip-tasks \
    --data-file "$repository_root/infra/project-modules/tests/provider-isolation/$fixture" \
    "$repository_root" \
    "$render_dir"
  local rendered_root="$render_dir/infra/$root_name"
  terraform -chdir="$rendered_root" fmt -check
  export TF_DATA_DIR="$test_data_dir/terraform-data-$root_name"
  terraform -chdir="$rendered_root" init -backend=false -input=false > /dev/null
  terraform -chdir="$rendered_root" validate > /dev/null
}

render_fixture answers-cloudflare.yml cloudflare-only
render_fixture answers-neon.yml neon-only
render_fixture answers-all.yml all-capabilities
render_fixture answers-policy-only.yml policy-only

policy_only_root="$test_data_dir/answers-policy-only.yml/infra/policy-only/generated-project.tf"
for forbidden in cloudflare/cloudflare kislerdm/neon; do
  if grep -Fq "$forbidden" "$policy_only_root"; then
    echo "Policy-only selections unexpectedly enabled provider $forbidden" >&2
    exit 1
  fi
done

no_root_dir="$test_data_dir/no-terraform-root"
copier copy \
  --quiet \
  --defaults \
  --skip-tasks \
  --data-file "$repository_root/infra/project-modules/tests/provider-isolation/answers-no-root.yml" \
  "$repository_root" \
  "$no_root_dir"
if find "$no_root_dir" -name generated-project.tf -print -quit | grep -q .; then
  echo "Template generated Terraform for a blueprint without a terraform-root component" >&2
  exit 1
fi

render_dir="$test_data_dir/provider-isolation"
mkdir -p "$render_dir/infra"
ln -s "$repository_root/infra/project-modules" "$render_dir/infra/project-modules"
copier copy \
  --quiet \
  --defaults \
  --skip-tasks \
  --data-file "$repository_root/infra/project-modules/tests/provider-isolation/answers.yml" \
  "$repository_root" \
  "$render_dir"
rendered_root="$render_dir/infra/provider-isolation"
cp tests/provider-isolation/.terraform.lock.hcl "$rendered_root/.terraform.lock.hcl"
cp tests/provider-isolation/provider-isolation.tftest.hcl "$rendered_root/provider-isolation.tftest.hcl"

terraform -chdir="$rendered_root" fmt -check
export TF_DATA_DIR="$test_data_dir/terraform-data"
terraform -chdir="$rendered_root" init -backend=false -input=false -lockfile=readonly > /dev/null
providers="$(terraform -chdir="$rendered_root" providers)"
for forbidden in DopplerHQ/doppler integrations/github PostHog/posthog hashicorp/tfe; do
  if grep -Fq "$forbidden" <<<"$providers"; then
    echo "Generated provider graph unexpectedly contains $forbidden" >&2
    exit 1
  fi
done
terraform -chdir="$rendered_root" test
