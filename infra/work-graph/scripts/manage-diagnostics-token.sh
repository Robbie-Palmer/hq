#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plan_path="${WORK_GRAPH_DIAGNOSTICS_TOKEN_PLAN:-$script_dir/../diagnostics-token.json}"
mode="${1:-plan}"
if (($#)); then shift; fi

for command_name in curl doppler gh jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Cannot manage the Work Graph diagnostic token: $command_name is required." >&2
    exit 1
  fi
done

if [[ ! -f "$plan_path" ]]; then
  echo "Cannot manage the Work Graph diagnostic token: the lifecycle plan is missing." >&2
  exit 1
fi

if ! jq -e '
  .schemaVersion == 1 and
  .providerOrigins == {
    cloudflare: "https://api.cloudflare.com",
    doppler: "https://api.doppler.com",
    github: "https://api.github.com"
  } and
  .token.name == "work-graph-diagnostics" and
  .token.accountIdEnvironment == "CLOUDFLARE_ACCOUNT_ID" and
  .token.provisionerTokenEnvironment == "CLOUDFLARE_TOKEN_PROVISIONER_TOKEN" and
  (.token.permissions | length) == 2 and
  ([.token.permissions[].name] | sort) == [
    "Account Analytics Read",
    "Workers Observability Write"
  ] and
  ([.token.permissions[].id] | unique | length) == 2 and
  (all(.token.permissions[].id; test("^[0-9a-f]{32}$"))) and
  .systemOfRecord == {
    project: "work-graph",
    config: "prd_work_graph",
    secretName: "CLOUDFLARE_DIAGNOSTICS_API_TOKEN",
    managedTokenIdName: "CLOUDFLARE_DIAGNOSTICS_API_TOKEN_ID",
    credentialEnvironment: "DOPPLER_BOOTSTRAP_TOKEN"
  } and
  .githubConsumer == {
    repository: "Robbie-Palmer/hq",
    environment: "production-work-graph",
    secretName: "CLOUDFLARE_DIAGNOSTICS_API_TOKEN",
    credentialEnvironment: "GH_BOOTSTRAP_TOKEN"
  } and
  .verification == {
    environment: "production-work-graph",
    task: "//workers/work-graph-api:diagnostics:query"
  }
' "$plan_path" >/dev/null; then
  echo "The Work Graph diagnostic-token lifecycle plan is invalid or over-privileged." >&2
  exit 1
fi

token_name="$(jq -er '.token.name' "$plan_path")"
account_id_environment="$(jq -er '.token.accountIdEnvironment' "$plan_path")"
provisioner_environment="$(jq -er '.token.provisionerTokenEnvironment' "$plan_path")"
doppler_project="$(jq -er '.systemOfRecord.project' "$plan_path")"
doppler_config="$(jq -er '.systemOfRecord.config' "$plan_path")"
doppler_secret_name="$(jq -er '.systemOfRecord.secretName' "$plan_path")"
managed_id_name="$(jq -er '.systemOfRecord.managedTokenIdName' "$plan_path")"
doppler_credential_environment="$(jq -er '.systemOfRecord.credentialEnvironment' "$plan_path")"
github_repository="$(jq -er '.githubConsumer.repository' "$plan_path")"
github_environment="$(jq -er '.githubConsumer.environment' "$plan_path")"
github_secret_name="$(jq -er '.githubConsumer.secretName' "$plan_path")"
github_credential_environment="$(jq -er '.githubConsumer.credentialEnvironment' "$plan_path")"
doppler_api_origin="$(jq -er '.providerOrigins.doppler' "$plan_path")"

if [[ "$mode" == "plan" ]]; then
  jq '{
    schemaVersion,
    token: {
      name: .token.name,
      accountIdEnvironment: .token.accountIdEnvironment,
      permissions: .token.permissions
    },
    systemOfRecord: (
      "doppler:" + .systemOfRecord.project + "/" + .systemOfRecord.config + "/" + .systemOfRecord.secretName
    ),
    managedTokenId: .systemOfRecord.managedTokenIdName,
    consumer: (
      "github:" + .githubConsumer.repository + "/" + .githubConsumer.environment + "/" + .githubConsumer.secretName
    ),
    verification: .verification,
    operations: ["reconcile", "rotate", "retire"]
  }' "$plan_path"
  exit 0
fi

required_environment_values=("$account_id_environment")
if [[ "$mode" == "prepare" || "$mode" == "finalize" || "$mode" == "retire" ]]; then
  required_environment_values+=("$provisioner_environment")
fi
if [[ "$mode" == "prepare" || "$mode" == "retire" ]]; then
  required_environment_values+=(
    "$doppler_credential_environment"
    "$github_credential_environment"
  )
fi
if [[ "$mode" == "verify-consumer" ]]; then
  required_environment_values+=("CLOUDFLARE_DIAGNOSTICS_API_TOKEN")
fi
for environment_name in "${required_environment_values[@]}"; do
  if [[ -z "${!environment_name:-}" ]]; then
    echo "Cannot manage the Work Graph diagnostic token: $environment_name is required." >&2
    exit 1
  fi
done

account_id="${!account_id_environment}"
if [[ ! "$account_id" =~ ^[0-9a-f]{32}$ ]]; then
  echo "Cannot manage the Work Graph diagnostic token: the account ID is invalid." >&2
  exit 1
fi

secrets_root="${TMPDIR:-/tmp}"
if [[ -d /dev/shm && -w /dev/shm ]]; then
  secrets_root="/dev/shm"
fi
work_dir="$(mktemp -d "${secrets_root%/}/work-graph-diagnostics-token.XXXXXX")"
chmod 700 "$work_dir"
cleanup() {
  local exit_status="$?"
  find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$work_dir" 2>/dev/null || true
  return "$exit_status"
}
trap cleanup EXIT INT TERM

cloudflare_auth="$work_dir/cloudflare.curl"
if [[ -n "${!provisioner_environment:-}" ]]; then
  printf 'header = "Authorization: Bearer %s"\n' "${!provisioner_environment}" >"$cloudflare_auth"
  chmod 600 "$cloudflare_auth"
fi

cloudflare_request() {
  local output="$1"
  local method="$2"
  local path="$3"
  local body="${4:-}"
  local -a arguments=(
    --disable
    --config "$cloudflare_auth"
    --connect-timeout 10
    --fail
    --max-time 60
    --request "$method"
    --silent
    --show-error
    --output "$output"
    --url "https://api.cloudflare.com/client/v4/accounts/$account_id$path"
  )
  if [[ -n "$body" ]]; then
    arguments+=(--header "Content-Type: application/json" --data-binary "@$body")
  fi
  if ! curl "${arguments[@]}"; then
    echo "Cloudflare diagnostic-token request failed for $method $path." >&2
    return 1
  fi
  chmod 600 "$output"
  if ! jq -e '.success == true and ((.errors // []) | length == 0)' "$output" >/dev/null; then
    echo "Cloudflare rejected the diagnostic-token request for $method $path." >&2
    return 1
  fi
}

permission_ids="$(jq -c '[.token.permissions[].id] | sort' "$plan_path")"
account_resource="com.cloudflare.api.account.$account_id"

check_provisioning_authority() {
  local permissions_file="$work_dir/permission-groups.json"
  local verify_file="$work_dir/provisioner-verify.json"
  local details_file="$work_dir/provisioner-details.json"
  cloudflare_request "$permissions_file" GET "/tokens/permission_groups"

  if ! jq -e --slurpfile plan "$plan_path" '
    ($plan[0].token.permissions | sort_by(.id)) as $expected
    | ([.result[]
        | select(.id as $id | any($expected[]; .id == $id))
        | {id, name, is_selectable, scopes}] | sort_by(.id)) as $actual
    | ($actual | length) == ($expected | length)
    and all(range(0; $expected | length);
      $actual[.] .id == $expected[.] .id and
      $actual[.] .name == $expected[.] .name and
      $actual[.] .is_selectable == true and
      ($actual[.] .scopes | index("com.cloudflare.api.account")) != null)
  ' "$permissions_file" >/dev/null; then
    echo "Cloudflare permission groups do not match the declared diagnostic-token policy." >&2
    return 1
  fi

  local bootstrap_permission_id
  bootstrap_permission_id="$(jq -er '
    first(.result[] | select(
      .name == "Account API Tokens Write" and
      .is_selectable == true and
      (.scopes | index("com.cloudflare.api.account")) != null
    ) | .id)
  ' "$permissions_file")"
  cloudflare_request "$verify_file" GET "/tokens/verify"
  local provisioner_id
  provisioner_id="$(jq -er '.result | select(.status == "active") | .id' "$verify_file")"
  cloudflare_request "$details_file" GET "/tokens/$provisioner_id"
  if ! jq -e \
    --arg account_resource "$account_resource" \
    --arg permission_id "$bootstrap_permission_id" '
      .result.status == "active" and
      (.result.policies | length) == 1 and
      (.result.policies[0].effect == "allow") and
      ([.result.policies[0].permission_groups[].id] == [$permission_id]) and
      (.result.policies[0].resources == {($account_resource): "*"})
    ' "$details_file" >/dev/null; then
    echo "The Cloudflare provisioner must grant only Account API Tokens Write for the declared account." >&2
    return 1
  fi
}

inventory_tokens() {
  local inventory_file="$1"
  local page=1
  local pages=1
  : >"$inventory_file"
  while ((page <= pages)); do
    local response="$work_dir/tokens-$page.json"
    cloudflare_request "$response" GET "/tokens?page=$page&per_page=50"
    jq -r --arg name "$token_name" '
      .result[]
      | select(.name == $name and .status == "active")
      | .id
      | select(test("^[0-9a-f]{32}$"))
    ' "$response" >>"$inventory_file"
    pages="$(jq -er '(.result_info.total_pages // 1) | select(type == "number" and . >= 1)' "$response")"
    page=$((page + 1))
  done
  sort -u "$inventory_file" -o "$inventory_file"
}

token_has_declared_policy() {
  local token_id="$1"
  local details_file="$work_dir/token-$token_id.json"
  cloudflare_request "$details_file" GET "/tokens/$token_id"
  jq -e \
    --arg account_resource "$account_resource" \
    --arg name "$token_name" \
    --argjson permission_ids "$permission_ids" '
      .result.id != null and
      .result.name == $name and
      .result.status == "active" and
      (.result.policies | length) == 1 and
      .result.policies[0].effect == "allow" and
      ([.result.policies[0].permission_groups[].id] | sort) == $permission_ids and
      .result.policies[0].resources == {($account_resource): "*"}
    ' "$details_file" >/dev/null
}

delete_token() {
  local token_id="$1"
  local response="$work_dir/delete-$token_id.json"
  cloudflare_request "$response" DELETE "/tokens/$token_id"
}

preflight_consumers() {
  GH_TOKEN="${!github_credential_environment}" \
    GH_HOST=github.com \
    GH_PROMPT_DISABLED=1 \
    gh secret list \
      --env "$github_environment" \
      --repo "$github_repository" \
      --json name >"$work_dir/github-secrets.json"
  DOPPLER_TOKEN="${!doppler_credential_environment}" \
    doppler secrets get "$managed_id_name" \
      --project "$doppler_project" \
      --config "$doppler_config" \
      --api-host "$doppler_api_origin" \
      --no-exit-on-missing-secret \
      --plain \
      --silent >"$work_dir/managed-id.txt"
  chmod 600 "$work_dir/managed-id.txt"
  DOPPLER_TOKEN="${!doppler_credential_environment}" \
    doppler secrets get "$doppler_secret_name" \
      --project "$doppler_project" \
      --config "$doppler_config" \
      --api-host "$doppler_api_origin" \
      --no-exit-on-missing-secret \
      --plain \
      --silent >"$work_dir/doppler-consumer-token.txt"
  chmod 600 "$work_dir/doppler-consumer-token.txt"
}

consumer_token_matches_id() {
  local expected_id="$1"
  local token_file="$2"
  local auth_file="$work_dir/consumer-token.curl"
  local response_file="$work_dir/consumer-token-verify.json"
  if [[ ! -s "$token_file" ]]; then
    return 1
  fi
  {
    printf 'header = "Authorization: Bearer '
    tr -d '\r\n' <"$token_file"
    printf '"\n'
  } >"$auth_file"
  chmod 600 "$auth_file"
  if ! curl --disable \
    --config "$auth_file" \
    --connect-timeout 10 \
    --fail \
    --max-time 30 \
    --silent \
    --show-error \
    --output "$response_file" \
    --url "https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/verify"; then
    return 1
  fi
  chmod 600 "$response_file"
  jq -e --arg expected_id "$expected_id" '
    .success == true and
    ((.errors // []) | length) == 0 and
    .result.id == $expected_id and
    .result.status == "active"
  ' "$response_file" >/dev/null
}

write_candidate_to_consumers() {
  local response_file="$1"
  if ! jq -je '.result.value | select(type == "string" and length > 0)' "$response_file" |
    GH_TOKEN="${!github_credential_environment}" \
      GH_HOST=github.com \
      GH_PROMPT_DISABLED=1 \
      gh secret set "$github_secret_name" \
        --env "$github_environment" \
        --repo "$github_repository" >/dev/null; then
    echo "The candidate token could not be written to the GitHub consumer. It remains active for recovery." >&2
    return 1
  fi
  if ! jq -je '.result.value | select(type == "string" and length > 0)' "$response_file" |
    DOPPLER_TOKEN="${!doppler_credential_environment}" \
      doppler secrets set "$doppler_secret_name" \
        --project "$doppler_project" \
        --config "$doppler_config" \
        --visibility masked \
        --api-host "$doppler_api_origin" \
        --no-interactive \
        --silent >/dev/null; then
    echo "The candidate token could not be written to Doppler. It remains active for recovery." >&2
    return 1
  fi
}

write_token_file_to_github() {
  local token_file="$1"
  if ! GH_TOKEN="${!github_credential_environment}" \
    GH_HOST=github.com \
    GH_PROMPT_DISABLED=1 \
    gh secret set "$github_secret_name" \
      --env "$github_environment" \
      --repo "$github_repository" <"$token_file" >/dev/null; then
    echo "The managed token could not be written to the GitHub consumer." >&2
    return 1
  fi
}

write_managed_id() {
  local token_id="$1"
  printf '%s' "$token_id" |
    DOPPLER_TOKEN="${!doppler_credential_environment}" \
      doppler secrets set "$managed_id_name" \
        --project "$doppler_project" \
        --config "$doppler_config" \
        --visibility unmasked \
        --api-host "$doppler_api_origin" \
        --no-interactive \
        --silent >/dev/null
}

prepare_token() {
  local rotate=false
  if [[ "${1:-}" == "--rotate" ]]; then
    rotate=true
    shift
  fi
  if (($#)); then
    echo "Usage: manage-diagnostics-token.sh prepare [--rotate]" >&2
    return 2
  fi

  check_provisioning_authority
  preflight_consumers
  local inventory="$work_dir/token-inventory.txt"
  inventory_tokens "$inventory"
  local managed_id
  managed_id="$(tr -d '\r\n' <"$work_dir/managed-id.txt")"
  if [[ -n "$managed_id" && ! "$managed_id" =~ ^[0-9a-f]{32}$ ]]; then
    echo "The managed diagnostic-token ID in Doppler is invalid." >&2
    return 1
  fi

  local current_id=""
  local action="created"
  if [[ "$rotate" == false && -n "$managed_id" ]] &&
    grep -Fxq "$managed_id" "$inventory" &&
    token_has_declared_policy "$managed_id" &&
    consumer_token_matches_id "$managed_id" "$work_dir/doppler-consumer-token.txt"; then
    current_id="$managed_id"
    action="reused"
    write_token_file_to_github "$work_dir/doppler-consumer-token.txt"
  else
    local request_file="$work_dir/create-token.json"
    local response_file="$work_dir/create-token-response.json"
    jq -n \
      --arg name "$token_name" \
      --arg account_resource "$account_resource" \
      --slurpfile plan "$plan_path" '
        {
          name: $name,
          policies: [{
            effect: "allow",
            permission_groups: [$plan[0].token.permissions[] | {id}],
            resources: {($account_resource): "*"}
          }]
        }
      ' >"$request_file"
    cloudflare_request "$response_file" POST "/tokens" "$request_file"
    if ! jq -e '
      .result.id | type == "string" and test("^[0-9a-f]{32}$")
    ' "$response_file" >/dev/null ||
      ! jq -e '.result.value | type == "string" and length > 0' "$response_file" >/dev/null; then
      echo "Cloudflare did not return a valid token ID and one-time value." >&2
      return 1
    fi
    current_id="$(jq -er '.result.id' "$response_file")"
    write_candidate_to_consumers "$response_file"
    write_managed_id "$current_id"
  fi

  jq -n \
    --arg action "$action" \
    --arg current_id "$current_id" \
    --rawfile inventory "$inventory" '
      {
        action: $action,
        currentTokenId: $current_id,
        previousTokenIds: (
          $inventory
          | split("\n")
          | map(select(length > 0 and . != $current_id))
        ),
        requiresVerification: true
      }
    '
}

verify_consumer() {
  local expected_id=""
  while (($#)); do
    case "$1" in
      --expected-id)
        expected_id="${2:-}"
        shift 2
        ;;
      *)
        echo "Usage: manage-diagnostics-token.sh verify-consumer --expected-id <id>" >&2
        return 2
        ;;
    esac
  done
  if [[ ! "$expected_id" =~ ^[0-9a-f]{32}$ ]]; then
    echo "A valid expected token ID is required for consumer verification." >&2
    return 2
  fi
  printf '%s' "$CLOUDFLARE_DIAGNOSTICS_API_TOKEN" >"$work_dir/runtime-consumer-token.txt"
  chmod 600 "$work_dir/runtime-consumer-token.txt"
  if ! consumer_token_matches_id "$expected_id" "$work_dir/runtime-consumer-token.txt"; then
    echo "The diagnostic-token consumer does not hold the prepared active token." >&2
    return 1
  fi
  jq -n --arg token_id "$expected_id" '{verifiedTokenId: $token_id}'
}

finalize_token() {
  local current_id=""
  while (($#)); do
    case "$1" in
      --current-id)
        current_id="${2:-}"
        shift 2
        ;;
      *)
        echo "Usage: manage-diagnostics-token.sh finalize --current-id <id>" >&2
        return 2
        ;;
    esac
  done
  if [[ ! "$current_id" =~ ^[0-9a-f]{32}$ ]]; then
    echo "A valid current token ID is required for finalization." >&2
    return 2
  fi

  check_provisioning_authority
  local inventory="$work_dir/token-inventory.txt"
  inventory_tokens "$inventory"
  if ! grep -Fxq "$current_id" "$inventory" || ! token_has_declared_policy "$current_id"; then
    echo "Refusing to revoke prior tokens because the verified current token is missing or drifted." >&2
    return 1
  fi

  local -a retired_ids=()
  while IFS= read -r token_id; do
    [[ -z "$token_id" || "$token_id" == "$current_id" ]] && continue
    delete_token "$token_id"
    retired_ids+=("$token_id")
  done <"$inventory"
  printf '%s\n' "${retired_ids[@]}" |
    jq -Rs --arg current_id "$current_id" '{
      currentTokenId: $current_id,
      retiredTokenIds: (split("\n") | map(select(length > 0)))
    }'
}

retire_token() {
  local confirmation="${1:-}"
  if (($# != 1)) || [[ "$confirmation" != "$token_name" ]]; then
    echo "Retirement requires the exact token name '$token_name' as confirmation." >&2
    return 2
  fi
  check_provisioning_authority
  preflight_consumers
  if jq -e --arg name "$github_secret_name" 'any(.[]; .name == $name)' \
    "$work_dir/github-secrets.json" >/dev/null; then
    GH_TOKEN="${!github_credential_environment}" \
      GH_HOST=github.com \
      GH_PROMPT_DISABLED=1 \
      gh secret delete "$github_secret_name" \
        --env "$github_environment" \
        --repo "$github_repository" >/dev/null
  fi
  local -a doppler_names=()
  [[ -s "$work_dir/doppler-consumer-token.txt" ]] && doppler_names+=("$doppler_secret_name")
  [[ -s "$work_dir/managed-id.txt" ]] && doppler_names+=("$managed_id_name")
  if ((${#doppler_names[@]})); then
    DOPPLER_TOKEN="${!doppler_credential_environment}" \
      doppler secrets delete "${doppler_names[@]}" \
        --project "$doppler_project" \
        --config "$doppler_config" \
        --api-host "$doppler_api_origin" \
        --yes \
        --silent >/dev/null
  fi

  local inventory="$work_dir/token-inventory.txt"
  inventory_tokens "$inventory"
  local -a retired_ids=()
  while IFS= read -r token_id; do
    [[ -z "$token_id" ]] && continue
    delete_token "$token_id"
    retired_ids+=("$token_id")
  done <"$inventory"
  jq -n --args '{retired: true, retiredTokenIds: $ARGS.positional}' -- "${retired_ids[@]}"
}

case "$mode" in
  prepare) prepare_token "$@" ;;
  verify-consumer) verify_consumer "$@" ;;
  finalize) finalize_token "$@" ;;
  retire) retire_token "$@" ;;
  *)
    echo "Usage: manage-diagnostics-token.sh {plan|prepare|finalize|retire}" >&2
    exit 2
    ;;
esac
