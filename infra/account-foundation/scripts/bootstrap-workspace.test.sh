#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/account-foundation-bootstrap-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

mock_bin="$work_dir/bin"
request_log="$work_dir/requests"
mkdir -p "$mock_bin"

cat > "$mock_bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail

method="GET"
output_file=""
while (($#)); do
  case "$1" in
    --request)
      method="$2"
      shift 2
      ;;
    --output)
      output_file="$2"
      shift 2
      ;;
    --header | --write-out | --data)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf '%s\n' "$method" >> "$MOCK_REQUEST_LOG"

case "$MOCK_SCENARIO:$method" in
  existing:GET)
    printf '%s' '{"data":{"attributes":{"execution-mode":"local","auto-apply":false,"global-remote-state":false}}}' > "$output_file"
    printf '200'
    ;;
  mismatch:GET)
    printf '%s' '{"data":{"attributes":{"execution-mode":"remote","auto-apply":false,"global-remote-state":false}}}' > "$output_file"
    printf '200'
    ;;
  missing:GET)
    printf '%s' '{"errors":[{"status":"404"}]}' > "$output_file"
    printf '404'
    ;;
  missing:POST)
    printf '%s' '{"data":{"attributes":{"execution-mode":"local","auto-apply":false,"global-remote-state":false}}}' > "$output_file"
    printf '201'
    ;;
  unauthorized:GET)
    printf '%s' '{"errors":[{"status":"401"}]}' > "$output_file"
    printf '401'
    ;;
  *)
    echo "Unexpected mock request: $MOCK_SCENARIO $method" >&2
    exit 1
    ;;
esac
MOCK_CURL
chmod +x "$mock_bin/curl"

run_bootstrap() {
  local scenario="$1"
  MOCK_SCENARIO="$scenario" \
    MOCK_REQUEST_LOG="$request_log" \
    PATH="$mock_bin:$PATH" \
    TFE_TOKEN="test-bootstrap-secret" \
    bash "$script_dir/bootstrap-workspace.sh"
}

: > "$request_log"
existing_output="$(run_bootstrap existing)"
[[ "$existing_output" == "Verified the existing account-foundation HCP workspace." ]]
[[ "$(<"$request_log")" == "GET" ]]

: > "$request_log"
missing_output="$(run_bootstrap missing)"
[[ "$missing_output" == "Created the account-foundation HCP workspace in local execution mode." ]]
[[ "$(<"$request_log")" == $'GET\nPOST' ]]

: > "$request_log"
if mismatch_output="$(run_bootstrap mismatch 2>&1)"; then
  echo "Expected a mismatched existing workspace to fail." >&2
  exit 1
fi
[[ "$mismatch_output" == *"will not modify an existing workspace"* ]]

: > "$request_log"
if unauthorized_output="$(run_bootstrap unauthorized 2>&1)"; then
  echo "Expected an unauthorized workspace lookup to fail." >&2
  exit 1
fi
[[ "$unauthorized_output" == *"HTTP 401"* ]]

all_output="$existing_output$missing_output$mismatch_output$unauthorized_output"
if [[ "$all_output" == *"test-bootstrap-secret"* ]]; then
  echo "The bootstrap secret appeared in command output." >&2
  exit 1
fi

if grep -Eq 'DELETE|PATCH' "$request_log"; then
  echo "The bootstrap task attempted to modify or delete an existing workspace." >&2
  exit 1
fi

env CI=true \
  TF_API_TOKEN="test-state-token" \
  DOPPLER_TOKEN="test-doppler-token" \
  ACCOUNT_FOUNDATION_GITHUB_TOKEN="test-github-token" \
  GITHUB_TOKEN="inherited-github-token" \
  TFE_TOKEN="inherited-state-token" \
  TF_TOKEN_app_terraform_io="inherited-state-token" \
  bash "$script_dir/doppler-terraform-env.sh" plan bash -c '
    [[ "$TF_TOKEN_app_terraform_io" == "test-state-token" ]]
    [[ "$TFE_TOKEN" == "test-state-token" ]]
    [[ "$DOPPLER_TOKEN" == "test-doppler-token" ]]
    [[ "$GITHUB_TOKEN" == "test-github-token" ]]
  '

cat > "$mock_bin/doppler" <<'MOCK_DOPPLER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$DOPPLER_ARGS_LOG"
MOCK_DOPPLER
chmod +x "$mock_bin/doppler"

for mode_and_config in \
  "seed:ops_account_foundation_seed" \
  "plan:ops_account_foundation_plan" \
  "apply:ops_account_foundation"; do
  mode="${mode_and_config%%:*}"
  expected_config="${mode_and_config#*:}"
  doppler_args_log="$work_dir/doppler-$mode-args"

  env -u CI \
    -u DOPPLER_ACCOUNT_FOUNDATION_ENV_WRAPPED \
    -u DOPPLER_ACCOUNT_FOUNDATION_SEED_CONFIG \
    -u DOPPLER_ACCOUNT_FOUNDATION_PLAN_CONFIG \
    -u DOPPLER_ACCOUNT_FOUNDATION_APPLY_CONFIG \
    DOPPLER_ARGS_LOG="$doppler_args_log" \
    PATH="$mock_bin:$PATH" \
    bash "$script_dir/doppler-terraform-env.sh" "$mode" true

  grep -Fxq -- "$expected_config" "$doppler_args_log"
done

if CI=true bash "$script_dir/doppler-terraform-env.sh" invalid true 2>/dev/null; then
  echo "Expected an unknown credential mode to fail." >&2
  exit 1
fi

if missing_credential_output="$(
  env -u TF_API_TOKEN \
    -u DOPPLER_TOKEN \
    -u ACCOUNT_FOUNDATION_GITHUB_TOKEN \
    -u TF_TOKEN_app_terraform_io \
    -u TFE_TOKEN \
    -u GITHUB_TOKEN \
    CI=true \
    bash "$script_dir/doppler-terraform-env.sh" plan true 2>&1
)"; then
  echo "Expected missing plan credentials to fail." >&2
  exit 1
fi
[[ "$missing_credential_output" == *"TF_API_TOKEN is missing"* ]]

cat > "$work_dir/account-foundation-secrets.json" <<'FIXTURE'
{
  "ACCOUNT_FOUNDATION_GITHUB_TOKEN": {
    "computed": "fixture-github-token",
    "computedVisibility": "masked"
  },
  "DOPPLER_PROJECT": {
    "computed": "personal-site",
    "computedVisibility": "unmasked"
  },
  "DOPPLER_TOKEN": {
    "computed": "fixture-doppler-token",
    "computedVisibility": "masked"
  },
  "TF_API_TOKEN": {
    "computed": "fixture-terraform-token",
    "computedVisibility": "masked"
  }
}
FIXTURE

cat > "$mock_bin/doppler" <<'MOCK_DOPPLER'
#!/usr/bin/env bash
set -euo pipefail
cat "$SYNC_TEST_DIRECTORY/account-foundation-secrets.json"
MOCK_DOPPLER
chmod +x "$mock_bin/doppler"

cat > "$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${2:-}" == "list" ]]; then
  echo '[]'
  exit 0
fi
if [[ "${2:-}" == "set" ]]; then
  printf '%s %s %s %s\n' "$1" "$2" "$3" "$5" >> "$SYNC_TEST_DIRECTORY/github-calls"
fi
MOCK_GH
chmod +x "$mock_bin/gh"

: > "$work_dir/github-calls"
SYNC_TEST_DIRECTORY="$work_dir" \
  PATH="$mock_bin:$PATH" \
  bash "$script_dir/../../../scripts/sync-doppler-github-envs.sh" \
    production-account-foundation-plan \
    production-account-foundation

for github_environment in \
  production-account-foundation-plan \
  production-account-foundation; do
  grep -Fxq -- "secret set DOPPLER_TOKEN $github_environment" "$work_dir/github-calls"
  grep -Fxq -- "secret set TF_API_TOKEN $github_environment" "$work_dir/github-calls"
  grep -Fxq -- "secret set ACCOUNT_FOUNDATION_GITHUB_TOKEN $github_environment" "$work_dir/github-calls"
  if grep -Fxq -- "variable set DOPPLER_PROJECT $github_environment" "$work_dir/github-calls"; then
    echo "The account-foundation sync exported reserved Doppler metadata." >&2
    exit 1
  fi
done

echo "Account-foundation bootstrap boundary tests passed."
