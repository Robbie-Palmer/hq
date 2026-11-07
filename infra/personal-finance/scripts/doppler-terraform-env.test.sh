#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/personal-finance-env-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

CI=true \
  TF_API_TOKEN="test-token" \
  POSTHOG_API_KEY="posthog-token" \
  PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_ACCESS='{"account_id":"account"}' \
  PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_R2='{"account_id":"account"}' \
  PERSONAL_FINANCE_TERRAFORM_CLOUDFLARE_WORKER='{"account_id":"account"}' \
  PERSONAL_FINANCE_TERRAFORM_NEON='{"org_id":"org"}' \
  PERSONAL_FINANCE_TERRAFORM_POSTHOG_ALERTING='{"host":"https://example.invalid"}' \
  PERSONAL_FINANCE_TERRAFORM_TELEMETRY='{"dashboard_name":"operations"}' \
  bash "$script_dir/doppler-terraform-env.sh" plan \
  bash -c '
    [[ "$TF_TOKEN_app_terraform_io" == "test-token" ]]
    [[ "$TF_VAR_posthog_api_key" == "posthog-token" ]]
    [[ "$TF_VAR_cloudflare_access" == "{\"account_id\":\"account\"}" ]]
    [[ "$TF_VAR_cloudflare_r2" == "{\"account_id\":\"account\"}" ]]
    [[ "$TF_VAR_cloudflare_worker" == "{\"account_id\":\"account\"}" ]]
    [[ "$TF_VAR_neon" == "{\"org_id\":\"org\"}" ]]
    [[ "$TF_VAR_posthog_alerting" == "{\"host\":\"https://example.invalid\"}" ]]
    [[ "$TF_VAR_telemetry" == "{\"dashboard_name\":\"operations\"}" ]]
  '

if CI=true bash "$script_dir/doppler-terraform-env.sh" plan true 2>/dev/null; then
  echo "The wrapper accepted a plan without TF_API_TOKEN." >&2
  exit 1
fi

if CI=true TF_API_TOKEN="test-token" \
  bash "$script_dir/doppler-terraform-env.sh" invalid true 2>/dev/null; then
  echo "The wrapper accepted an unknown credential mode." >&2
  exit 1
fi

mock_bin="$work_dir/bin"
mkdir -p "$mock_bin"
cat > "$mock_bin/doppler" <<'MOCK_DOPPLER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$DOPPLER_ARGS_LOG"
MOCK_DOPPLER
chmod +x "$mock_bin/doppler"

for mode_and_config in "plan ops" "drift drift" "apply apply"; do
  read -r mode expected_config <<<"$mode_and_config"
  args_log="$work_dir/$mode-args"
  CI=false \
    DOPPLER_PROJECT="unrelated-ambient-project" \
    PATH="$mock_bin:$PATH" \
    DOPPLER_ARGS_LOG="$args_log" \
    bash "$script_dir/doppler-terraform-env.sh" "$mode" true
  grep -Fxq -- "personal-finance" "$args_log"
  grep -Fxq -- "$expected_config" "$args_log"
done
