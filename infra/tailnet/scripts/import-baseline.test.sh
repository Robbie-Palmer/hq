#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/tailnet-import-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

fake_terraform="$test_dir/terraform"
state_file="$test_dir/state"
log_file="$test_dir/imports"

cat >"$fake_terraform" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  state)
    resource_address="$4"
    [[ -f "$FAKE_TERRAFORM_STATE" ]] && grep -Fqx "$resource_address" "$FAKE_TERRAFORM_STATE"
    ;;
  import)
    resource_address="$3"
    import_id="$4"
    printf '%s\n' "$resource_address" >>"$FAKE_TERRAFORM_STATE"
    printf '%s %s\n' "$resource_address" "$import_id" >>"$FAKE_TERRAFORM_LOG"
    ;;
  *)
    echo "Unexpected Terraform command: $*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$fake_terraform"

FAKE_TERRAFORM_STATE="$state_file" \
FAKE_TERRAFORM_LOG="$log_file" \
  bash "$script_dir/import-baseline.sh" "$fake_terraform"

expected_imports=$'tailscale_acl.tailnet acl\ntailscale_dns_configuration.tailnet dns_configuration'
[[ "$(<"$log_file")" == "$expected_imports" ]]

second_output="$test_dir/second-output"
FAKE_TERRAFORM_STATE="$state_file" \
FAKE_TERRAFORM_LOG="$log_file" \
  bash "$script_dir/import-baseline.sh" "$fake_terraform" >"$second_output"

[[ "$(<"$log_file")" == "$expected_imports" ]]
grep -Fq "tailscale_acl.tailnet is already imported." "$second_output"
grep -Fq "tailscale_dns_configuration.tailnet is already imported." "$second_output"
