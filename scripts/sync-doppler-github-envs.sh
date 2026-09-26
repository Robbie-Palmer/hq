#!/usr/bin/env bash
set -euo pipefail

default_project="${DOPPLER_PROJECT:-personal-site}"
requested_environments=("$@")

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

contains_name() {
  local needle="$1"
  local names="$2"

  grep -Fxq -- "$needle" <<<"$names"
}

load_config_entries() {
  local config_spec="$1"
  local doppler_project="$default_project"
  local doppler_config="$config_spec"
  local secrets_json

  if [[ "$config_spec" == */* ]]; then
    doppler_project="${config_spec%%/*}"
    doppler_config="${config_spec#*/}"
  fi

  secrets_json=$(doppler secrets --project "$doppler_project" --config "$doppler_config" --json)
  jq -c \
    --arg source "$doppler_project/$doppler_config" \
    --arg config "$doppler_config" '
    to_entries
    | map(select(
        (.key | startswith("DOPPLER_") | not)
        or (
          $config == "ops_preview_agent_access"
          and (
            .key == "DOPPLER_AGENT_CONFIG"
            or .key == "DOPPLER_PROJECT"
            or .key == "DOPPLER_SERVICE_TOKEN"
          )
        )
      ))
    | map({
        name: .key,
        value: .value.computed,
        visibility: .value.computedVisibility,
        source: $source
      })
  ' <<<"$secrets_json"
}

sync_env() {
  local github_env="$1"
  shift

  local entries_json="[]"
  local config_entries_json
  local existing_secrets_json
  local existing_vars_json
  local doppler_config

  echo "Syncing Doppler configs '$*' to GitHub environment '$github_env'"

  for doppler_config in "$@"; do
    config_entries_json=$(load_config_entries "$doppler_config")
    entries_json=$(jq -c -s '.[0] + .[1]' \
      <(printf '%s\n' "$entries_json") \
      <(printf '%s\n' "$config_entries_json"))
  done

  local duplicate_names
  duplicate_names=$(jq -r '
    group_by(.name)
    | map(select(length > 1))
    | .[]
    | select((map(.value) | unique | length) > 1 or (map(.visibility) | unique | length) > 1)
    | map(.source + ":" + .name)
    | join(", ")
  ' <<<"$entries_json")
  if [[ -n "$duplicate_names" ]]; then
    echo "Refusing to sync duplicate keys with different values or visibility: $duplicate_names" >&2
    exit 1
  fi

  entries_json=$(jq -c 'unique_by(.name)' <<<"$entries_json")

  desired_secrets=$(jq -r '.[] | select(.visibility != "unmasked") | .name' <<<"$entries_json")
  desired_vars=$(jq -r '.[] | select(.visibility == "unmasked") | .name' <<<"$entries_json")

  while IFS= read -r entry; do
    local name
    local source
    local value
    local visibility

    name=$(jq -r '.name' <<<"$entry")
    source=$(jq -r '.source' <<<"$entry")
    value=$(jq -r '.value // ""' <<<"$entry")
    visibility=$(jq -r '.visibility' <<<"$entry")

    if [[ -z "$value" ]]; then
      echo "Refusing to sync empty value: $source:$name" >&2
      exit 1
    fi

    if [[ "$visibility" == "unmasked" ]]; then
      gh variable set "$name" --env "$github_env" --body "$value" >/dev/null
      gh secret delete "$name" --env "$github_env" >/dev/null 2>&1 || true
    else
      gh secret set "$name" --env "$github_env" --body "$value" >/dev/null
      gh variable delete "$name" --env "$github_env" >/dev/null 2>&1 || true
    fi
  done < <(jq -c '.[]' <<<"$entries_json")

  existing_secrets_json=$(gh secret list --env "$github_env" --json name)
  existing_vars_json=$(gh variable list --env "$github_env" --json name)

  while IFS= read -r name; do
    if ! contains_name "$name" "$desired_secrets"; then
      echo "Deleting stale GitHub secret '$name' from '$github_env'"
      gh secret delete "$name" --env "$github_env" >/dev/null
    fi
  done < <(jq -r '.[].name' <<<"$existing_secrets_json")

  while IFS= read -r name; do
    if ! contains_name "$name" "$desired_vars"; then
      echo "Deleting stale GitHub variable '$name' from '$github_env'"
      gh variable delete "$name" --env "$github_env" >/dev/null
    fi
  done < <(jq -r '.[].name' <<<"$existing_vars_json")
}

should_sync_env() {
  local github_env="$1"
  local requested_environment

  if ((${#requested_environments[@]} == 0)); then
    return 0
  fi

  for requested_environment in "${requested_environments[@]}"; do
    if [[ "$requested_environment" == "$github_env" ]]; then
      return 0
    fi
  done

  return 1
}

sync_requested_env() {
  local github_env="$1"
  shift

  if should_sync_env "$github_env"; then
    sync_env "$github_env" "$@"
  fi
}

require_command doppler
require_command gh
require_command jq

known_environments=(
  preview-agent-access
  preview-recipe-api
  preview-site-ui
  production-recipe-api
  production-recipe-ingest
  production-site-ui
  production-infra
  production-infra-bootstrap
  production-infra-bootstrap-plan
  production-remote-development-infra
  production-remote-development-infra-plan
  production-work-graph
  production-work-graph-infra
  production-database-backup
  production-ci
  production-ai-review
)

for requested_environment in "${requested_environments[@]}"; do
  if ! contains_name "$requested_environment" "$(printf '%s\n' "${known_environments[@]}")"; then
    echo "Unknown GitHub environment: $requested_environment" >&2
    echo "Known environments: ${known_environments[*]}" >&2
    exit 1
  fi
done

sync_requested_env preview-agent-access ops_preview_agent_access
sync_requested_env preview-recipe-api stg_recipe_api stg_pages_env
sync_requested_env preview-site-ui stg_site_ui stg_pages_env
sync_requested_env production-recipe-api prd_recipe_api prd_site_ui prd_pages_env
sync_requested_env production-recipe-ingest prd_recipe_ingest prd_site_ui prd_pages_env
sync_requested_env production-site-ui prd_site_ui prd_pages_env
sync_requested_env production-infra prd_infra
sync_requested_env production-infra-bootstrap prd_bootstrap_infra
sync_requested_env production-infra-bootstrap-plan prd_bootstrap_plan
sync_requested_env production-remote-development-infra homelab/prd_remote_development_infra
sync_requested_env production-remote-development-infra-plan homelab/prd_remote_development_infra
sync_requested_env production-work-graph work-graph/prd_work_graph
sync_requested_env production-work-graph-infra work-graph/prd_work_graph_infra
sync_requested_env production-database-backup prd_database_backup
sync_requested_env production-ci prd_ci_repo
sync_requested_env production-ai-review ai-review/prd

if ((${#requested_environments[@]} == 0)); then
  echo "Manual Doppler to GitHub environment sync complete."
else
  echo "Manual Doppler to GitHub environment sync complete for: ${requested_environments[*]}"
fi
