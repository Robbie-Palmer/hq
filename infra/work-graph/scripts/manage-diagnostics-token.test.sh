#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lifecycle="$script_dir/manage-diagnostics-token.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-diagnostics-token-test.XXXXXX")"
cleanup() {
  find "$test_dir" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

cat >"$mock_bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail

method=GET
output=""
url=""
body=""
auth_config=""
candidate_token_placeholder="${MOCK_CANDIDATE_TOKEN_PLACEHOLDER:?}"
while (($#)); do
  case "$1" in
    --request) method="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    --data-binary) body="${2#@}"; shift 2 ;;
    --config) auth_config="$2"; shift 2 ;;
    --connect-timeout | --max-time | --header) shift 2 ;;
    --disable | --fail | --silent | --show-error) shift ;;
    *) echo "Unexpected curl argument: $1" >&2; exit 1 ;;
  esac
done

printf '%s %s\n' "$method" "$url" >>"$MOCK_REQUEST_LOG"
path="${url#https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID}"
bootstrap_id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
bootstrap_permission_id="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
observability_id="82c075da3f4647a2a03becd0fe240f8a"
analytics_id="b89a480218d04ceb98b4fe57ca29dc1f"

case "$method:$path" in
  GET:/tokens/permission_groups)
    jq -n \
      --arg bootstrap "$bootstrap_permission_id" \
      --arg observability "$observability_id" \
      --arg analytics "$analytics_id" '
      {
        success: true,
        errors: [],
        result: [
          {id: $bootstrap, name: "Account API Tokens Write", is_selectable: true, scopes: ["com.cloudflare.api.account"]},
          {id: $observability, name: "Workers Observability Write", is_selectable: true, scopes: ["com.cloudflare.api.account"]},
          {id: $analytics, name: "Account Analytics Read", is_selectable: true, scopes: ["com.cloudflare.api.account"]}
        ]
      }
    ' >"$output"
    ;;
  GET:/tokens/verify)
    verified_id="$bootstrap_id"
    if grep -Fq "$candidate_token_placeholder" "$auth_config"; then
      verified_id="$MOCK_NEW_TOKEN_ID"
    elif grep -Fq "existing-token-placeholder" "$auth_config"; then
      verified_id="$MOCK_EXISTING_TOKEN_ID"
    fi
    jq -n --arg id "$verified_id" '{success: true, errors: [], result: {id: $id, status: "active"}}' >"$output"
    ;;
  GET:/tokens/$bootstrap_id)
    jq -n \
      --arg id "$bootstrap_id" \
      --arg permission "$bootstrap_permission_id" \
      --arg resource "com.cloudflare.api.account.$CLOUDFLARE_ACCOUNT_ID" '
      {
        success: true,
        errors: [],
        result: {
          id: $id,
          status: "active",
          policies: [{effect: "allow", permission_groups: [{id: $permission}], resources: {($resource): "*"}}]
        }
      }
    ' >"$output"
    ;;
  GET:/tokens\?page=1\&per_page=50)
    jq -n \
      --arg inventory "${MOCK_INVENTORY:-}" '
      {
        success: true,
        errors: [],
        result: ($inventory | split(",") | map(select(length > 0) | {id: ., name: "work-graph-diagnostics", status: "active"})),
        result_info: {total_pages: 1}
      }
    ' >"$output"
    ;;
  GET:/tokens/*)
    token_id="${path##*/}"
    jq -n \
      --arg id "$token_id" \
      --arg observability "$observability_id" \
      --arg analytics "$analytics_id" \
      --arg resource "com.cloudflare.api.account.$CLOUDFLARE_ACCOUNT_ID" '
      {
        success: true,
        errors: [],
        result: {
          id: $id,
          name: "work-graph-diagnostics",
          status: "active",
          policies: [{
            effect: "allow",
            permission_groups: [{id: $observability}, {id: $analytics}],
            resources: {($resource): "*"}
          }]
        }
      }
    ' >"$output"
    ;;
  POST:/tokens)
    jq -e \
      --arg resource "com.cloudflare.api.account.$CLOUDFLARE_ACCOUNT_ID" \
      --arg observability "$observability_id" \
      --arg analytics "$analytics_id" '
      .name == "work-graph-diagnostics" and
      (.policies | length) == 1 and
      .policies[0].effect == "allow" and
      ([.policies[0].permission_groups[].id] | sort) == ([$observability, $analytics] | sort) and
      .policies[0].resources == {($resource): "*"}
    ' "$body" >/dev/null
    jq -n \
      --arg id "$MOCK_NEW_TOKEN_ID" \
      --arg value "$candidate_token_placeholder" '
      {success: true, errors: [], result: {id: $id, value: $value}}
    ' >"$output"
    ;;
  DELETE:/tokens/*)
    token_id="${path##*/}"
    jq -n --arg id "$token_id" '{success: true, errors: [], result: {id: $id}}' >"$output"
    ;;
  *)
    echo "Unexpected Cloudflare request: $method $path" >&2
    exit 1
    ;;
esac
MOCK_CURL
chmod +x "$mock_bin/curl"

cat >"$mock_bin/doppler" <<'MOCK_DOPPLER'
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-} ${2:-}"
name="${3:-}"
candidate_token_placeholder="${MOCK_CANDIDATE_TOKEN_PLACEHOLDER:?}"
case "$operation" in
  "secrets get")
    printf 'doppler get %s\n' "$name" >>"$MOCK_OPERATION_LOG"
    if [[ "$name" == "CLOUDFLARE_DIAGNOSTICS_API_TOKEN_ID" ]]; then
      printf '%s' "${MOCK_MANAGED_ID:-}"
    else
      printf '%s' "${MOCK_DOPPLER_CONSUMER_TOKEN:-}"
    fi
    ;;
  "secrets set")
    value="$(</dev/stdin)"
    if [[ "$name" == "CLOUDFLARE_DIAGNOSTICS_API_TOKEN" && "${MOCK_DOPPLER_SET_FAIL:-false}" == "true" ]]; then
      exit 1
    fi
    if [[ "$name" == "CLOUDFLARE_DIAGNOSTICS_API_TOKEN" && "$value" != "$candidate_token_placeholder" ]]; then
      echo "Unexpected diagnostic token placeholder." >&2
      exit 1
    fi
    if [[ "$name" == "CLOUDFLARE_DIAGNOSTICS_API_TOKEN_ID" && ! "$value" =~ ^[0-9a-f]{32}$ ]]; then
      echo "Unexpected managed token ID." >&2
      exit 1
    fi
    printf 'doppler set %s\n' "$name" >>"$MOCK_OPERATION_LOG"
    ;;
  "secrets delete")
    printf 'doppler delete %s %s\n' "$name" "${4:-}" >>"$MOCK_OPERATION_LOG"
    ;;
  *)
    echo "Unexpected Doppler operation: $*" >&2
    exit 1
    ;;
esac
MOCK_DOPPLER
chmod +x "$mock_bin/doppler"

cat >"$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-} ${2:-}"
name="${3:-}"
candidate_token_placeholder="${MOCK_CANDIDATE_TOKEN_PLACEHOLDER:?}"
case "$operation" in
  "secret list")
    printf 'github list\n' >>"$MOCK_OPERATION_LOG"
    if [[ "${MOCK_GITHUB_SECRET_EXISTS:-false}" == "true" ]]; then
      printf '%s\n' '[{"name":"CLOUDFLARE_DIAGNOSTICS_API_TOKEN"}]'
    else
      printf '%s\n' '[]'
    fi
    ;;
  "secret set")
    value="$(</dev/stdin)"
    if [[ "${MOCK_GITHUB_SET_FAIL:-false}" == "true" ]]; then
      exit 1
    fi
    [[ "$value" == "$candidate_token_placeholder" ]]
    printf 'github set %s\n' "$name" >>"$MOCK_OPERATION_LOG"
    ;;
  "secret delete")
    printf 'github delete %s\n' "$name" >>"$MOCK_OPERATION_LOG"
    ;;
  *)
    echo "Unexpected GitHub operation: $*" >&2
    exit 1
    ;;
esac
MOCK_GH
chmod +x "$mock_bin/gh"

account_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
new_id="cccccccccccccccccccccccccccccccc"
old_id="dddddddddddddddddddddddddddddddd"
candidate_token_placeholder="candidate-token-placeholder"
request_log="$test_dir/requests.log"
operation_log="$test_dir/operations.log"

run_lifecycle() {
  env \
    PATH="$mock_bin:$PATH" \
    MOCK_REQUEST_LOG="$request_log" \
    MOCK_OPERATION_LOG="$operation_log" \
    MOCK_INVENTORY="${MOCK_INVENTORY:-}" \
    MOCK_MANAGED_ID="${MOCK_MANAGED_ID:-}" \
    MOCK_DOPPLER_CONSUMER_TOKEN="${MOCK_DOPPLER_CONSUMER_TOKEN:-}" \
    MOCK_CANDIDATE_TOKEN_PLACEHOLDER="$candidate_token_placeholder" \
    MOCK_NEW_TOKEN_ID="$new_id" \
    MOCK_EXISTING_TOKEN_ID="$old_id" \
    MOCK_GITHUB_SECRET_EXISTS="${MOCK_GITHUB_SECRET_EXISTS:-false}" \
    MOCK_GITHUB_SET_FAIL="${MOCK_GITHUB_SET_FAIL:-false}" \
    MOCK_DOPPLER_SET_FAIL="${MOCK_DOPPLER_SET_FAIL:-false}" \
    CLOUDFLARE_ACCOUNT_ID="$account_id" \
    CLOUDFLARE_TOKEN_PROVISIONER_TOKEN="provisioner-token-placeholder" \
    DOPPLER_BOOTSTRAP_TOKEN="doppler-token-placeholder" \
    GH_BOOTSTRAP_TOKEN="github-token-placeholder" \
    bash "$lifecycle" "$@"
}

plan_output="$(run_lifecycle plan)"
jq -e '
  .token.name == "work-graph-diagnostics" and
  ([.token.permissions[].name] | sort) == ["Account Analytics Read", "Workers Observability Write"] and
  .operations == ["reconcile", "rotate", "retire"]
' <<<"$plan_output" >/dev/null

: >"$request_log"
: >"$operation_log"
prepare_output="$(MOCK_INVENTORY='' MOCK_MANAGED_ID='' run_lifecycle prepare)"
jq -e --arg id "$new_id" '
  .action == "created" and
  .currentTokenId == $id and
  .previousTokenIds == [] and
  .requiresVerification == true
' <<<"$prepare_output" >/dev/null
grep -Fxq "github set CLOUDFLARE_DIAGNOSTICS_API_TOKEN" "$operation_log"
grep -Fxq "doppler set CLOUDFLARE_DIAGNOSTICS_API_TOKEN" "$operation_log"
grep -Fxq "doppler set CLOUDFLARE_DIAGNOSTICS_API_TOKEN_ID" "$operation_log"

all_safe_output="$plan_output$prepare_output$(<"$request_log")$(<"$operation_log")"
for secret_placeholder in \
  "$candidate_token_placeholder" \
  provisioner-token-placeholder \
  doppler-token-placeholder \
  github-token-placeholder; do
  if [[ "$all_safe_output" == *"$secret_placeholder"* ]]; then
    echo "A credential placeholder crossed the output or argument boundary." >&2
    exit 1
  fi
done

: >"$request_log"
: >"$operation_log"
reuse_output="$(
  MOCK_INVENTORY="$new_id" \
  MOCK_MANAGED_ID="$new_id" \
  MOCK_DOPPLER_CONSUMER_TOKEN="$candidate_token_placeholder" \
  run_lifecycle prepare
)"
jq -e --arg id "$new_id" '.action == "reused" and .currentTokenId == $id' <<<"$reuse_output" >/dev/null
if grep -Fq "POST " "$request_log"; then
  echo "An idempotent reconcile created another token." >&2
  exit 1
fi

: >"$request_log"
: >"$operation_log"
rotate_output="$(
  MOCK_INVENTORY="$old_id" \
  MOCK_MANAGED_ID="$old_id" \
  MOCK_DOPPLER_CONSUMER_TOKEN="existing-token-placeholder" \
  run_lifecycle prepare --rotate
)"
jq -e --arg current "$new_id" --arg old "$old_id" '
  .action == "created" and
  .currentTokenId == $current and
  .previousTokenIds == [$old]
' <<<"$rotate_output" >/dev/null
grep -Fq "POST https://api.cloudflare.com/client/v4/accounts/$account_id/tokens" "$request_log"

: >"$request_log"
CLOUDFLARE_DIAGNOSTICS_API_TOKEN="$candidate_token_placeholder" \
  run_lifecycle verify-consumer --expected-id "$new_id" >/dev/null

: >"$request_log"
: >"$operation_log"
recovery_output="$(MOCK_INVENTORY="$old_id" MOCK_MANAGED_ID='' run_lifecycle prepare)"
jq -e --arg current "$new_id" --arg old "$old_id" '
  .currentTokenId == $current and .previousTokenIds == [$old]
' <<<"$recovery_output" >/dev/null

: >"$request_log"
MOCK_INVENTORY="$old_id,$new_id" run_lifecycle finalize --current-id "$new_id" >/dev/null
grep -Fq "DELETE https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/$old_id" "$request_log"
if grep -Fq "DELETE https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/$new_id" "$request_log"; then
  echo "Finalization revoked the verified current token." >&2
  exit 1
fi

: >"$request_log"
: >"$operation_log"
if MOCK_INVENTORY="$old_id" MOCK_MANAGED_ID='' MOCK_GITHUB_SET_FAIL=true \
  run_lifecycle prepare >"$test_dir/failed-prepare.out" 2>"$test_dir/failed-prepare.err"; then
  echo "Expected a failed GitHub handoff to stop preparation." >&2
  exit 1
fi
if grep -Fq "DELETE " "$request_log"; then
  echo "A failed handoff revoked an existing or candidate token." >&2
  exit 1
fi
if grep -Fq "$candidate_token_placeholder" "$test_dir/failed-prepare.err"; then
  echo "A failed handoff printed the candidate token." >&2
  exit 1
fi

: >"$request_log"
: >"$operation_log"
if MOCK_INVENTORY="$old_id" MOCK_MANAGED_ID='' MOCK_DOPPLER_SET_FAIL=true \
  run_lifecycle prepare >"$test_dir/failed-doppler.out" 2>"$test_dir/failed-doppler.err"; then
  echo "Expected a failed Doppler handoff to stop preparation." >&2
  exit 1
fi
grep -Fxq "github set CLOUDFLARE_DIAGNOSTICS_API_TOKEN" "$operation_log"
if grep -Fq "DELETE " "$request_log"; then
  echo "A partial consumer handoff revoked an existing or candidate token." >&2
  exit 1
fi
if grep -Fq "$candidate_token_placeholder" "$test_dir/failed-doppler.err"; then
  echo "A failed Doppler handoff printed the candidate token." >&2
  exit 1
fi

: >"$request_log"
: >"$operation_log"
MOCK_INVENTORY="$old_id,$new_id" \
MOCK_GITHUB_SECRET_EXISTS=true \
MOCK_MANAGED_ID="$new_id" \
MOCK_DOPPLER_CONSUMER_TOKEN="$candidate_token_placeholder" \
run_lifecycle retire work-graph-diagnostics >/dev/null
grep -Fxq "github delete CLOUDFLARE_DIAGNOSTICS_API_TOKEN" "$operation_log"
grep -Fxq "doppler delete CLOUDFLARE_DIAGNOSTICS_API_TOKEN CLOUDFLARE_DIAGNOSTICS_API_TOKEN_ID" "$operation_log"
grep -Fq "DELETE https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/$old_id" "$request_log"
grep -Fq "DELETE https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/$new_id" "$request_log"

echo "Work Graph diagnostic-token lifecycle tests passed."
