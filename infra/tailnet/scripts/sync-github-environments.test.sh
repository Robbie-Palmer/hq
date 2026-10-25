#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sync_script="$script_dir/../../../scripts/sync-doppler-github-envs.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/tailnet-github-sync-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

cat >"$mock_bin/doppler" <<'MOCK_DOPPLER'
#!/usr/bin/env bash
set -euo pipefail

config=""
while (($# > 0)); do
  if [[ "$1" == "--config" ]]; then
    config="$2"
    break
  fi
  shift
done

printf '%s\n' "$config" >>"$SYNC_TEST_DIRECTORY/doppler-calls"

case "$config" in
  prd_tailnet_values_infra_plan)
    credential="fixture-plan-client"
    ;;
  prd_tailnet_values_infra)
    credential="fixture-apply-client"
    ;;
  *)
    echo "Unexpected Doppler config: $config" >&2
    exit 1
    ;;
esac

jq -n \
  --arg credential "$credential" \
  '{
    TF_API_TOKEN: {computed: "fixture-terraform-token", computedVisibility: "masked"},
    TAILSCALE_OAUTH_CLIENT_ID: {computed: $credential, computedVisibility: "masked"},
    TAILSCALE_OAUTH_CLIENT_SECRET: {computed: "fixture-oauth-secret", computedVisibility: "masked"},
    TAILSCALE_TAILNET: {computed: "fixture.ts.net", computedVisibility: "masked"},
    TAILNET_USER_LOGIN_OPERATOR: {computed: "operator@example.com", computedVisibility: "masked"},
    TAILNET_PRIVATE_ADDRESS_LAB_HOST: {computed: "100.64.0.2", computedVisibility: "masked"},
    TAILNET_PRIVATE_ADDRESS_PRIMARY_DNS: {computed: "100.64.0.1", computedVisibility: "masked"},
    TAILSCALE_AUTH_KEY: {computed: "must-not-sync", computedVisibility: "masked"},
    HOMELAB_UNRELATED_SECRET: {computed: "must-not-sync-either", computedVisibility: "masked"},
    DOPPLER_PROJECT: {computed: "homelab", computedVisibility: "unmasked"}
  }
  | if env.SYNC_TEST_OMIT_REQUIRED == "1"
    then del(.TAILNET_PRIVATE_ADDRESS_LAB_HOST)
    else .
    end'
MOCK_DOPPLER
chmod +x "$mock_bin/doppler"

cat >"$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${2:-}" == "list" ]]; then
  echo '[]'
  exit 0
fi

if [[ "${2:-}" == "set" ]]; then
  printf '%s %s %s %s\n' "$1" "$2" "$3" "$5" >>"$SYNC_TEST_DIRECTORY/github-calls"
  exit 0
fi

echo "Unexpected gh invocation: $*" >&2
exit 1
MOCK_GH
chmod +x "$mock_bin/gh"

: >"$test_dir/doppler-calls"
: >"$test_dir/github-calls"

sync_output="$test_dir/sync-output"
SYNC_TEST_DIRECTORY="$test_dir" \
  PATH="$mock_bin:$PATH" \
  bash "$sync_script" \
    production-tailnet-infra-plan \
    production-tailnet-infra-drift \
    production-tailnet-infra >"$sync_output"

[[ "$(grep -cFx 'prd_tailnet_values_infra_plan' "$test_dir/doppler-calls")" == "2" ]]
[[ "$(grep -cFx 'prd_tailnet_values_infra' "$test_dir/doppler-calls")" == "1" ]]

for github_environment in \
  production-tailnet-infra-plan \
  production-tailnet-infra-drift \
  production-tailnet-infra; do
  for secret_name in \
    TF_API_TOKEN \
    TAILSCALE_OAUTH_CLIENT_ID \
    TAILSCALE_OAUTH_CLIENT_SECRET \
    TAILSCALE_TAILNET \
    TAILNET_USER_LOGIN_OPERATOR \
    TAILNET_PRIVATE_ADDRESS_LAB_HOST \
    TAILNET_PRIVATE_ADDRESS_PRIMARY_DNS; do
    grep -Fxq -- "secret set $secret_name $github_environment" "$test_dir/github-calls"
  done

  if grep -Fq -- "TAILSCALE_AUTH_KEY $github_environment" "$test_dir/github-calls" ||
    grep -Fq -- "HOMELAB_UNRELATED_SECRET $github_environment" "$test_dir/github-calls" ||
    grep -Fq -- "DOPPLER_PROJECT $github_environment" "$test_dir/github-calls"; then
    echo "Tailnet sync copied a value outside its allowlist." >&2
    exit 1
  fi
done

if grep -Eq 'fixture-(terraform-token|oauth-secret|plan-client|apply-client)' \
  "$sync_output" "$test_dir/github-calls"; then
  echo "Tailnet sync printed a credential value." >&2
  exit 1
fi

: >"$test_dir/github-calls"
if SYNC_TEST_DIRECTORY="$test_dir" \
  SYNC_TEST_OMIT_REQUIRED=1 \
  PATH="$mock_bin:$PATH" \
  bash "$sync_script" production-tailnet-infra-plan >"$sync_output" 2>&1; then
  echo "Tailnet sync accepted an incomplete config." >&2
  exit 1
fi

if [[ -s "$test_dir/github-calls" ]]; then
  echo "Tailnet sync mutated GitHub before validating required values." >&2
  exit 1
fi

grep -Fq -- "TAILNET_PRIVATE_ADDRESS_LAB_HOST" "$sync_output"

echo "Tailnet GitHub environment sync tests passed."
