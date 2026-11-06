#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(cd "$terraform_root/../.." && pwd)"
worker_root="$repository_root/workers/personal-finance-api"
runtime_root="$terraform_root/operations/runtime"
postgres_image="postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
check_only="${PERSONAL_FINANCE_OPERATION_CHECK_ONLY:-0}"
work_dir=""

fail() {
  echo "Personal Finance provider operation failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command '$1'"
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing required environment variable '$name'"
}

require_values() {
  local name
  for name in "$@"; do
    require_value "$name"
  done
}

finish_check() {
  if [[ "$check_only" == "1" ]]; then
    echo "Provider operation '$1' has all required names. Values were not printed."
    return 0
  fi
  return 1
}

cleanup() {
  local status="$?"
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
    rmdir "$work_dir" 2>/dev/null || true
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

make_work_dir() {
  local temp_root="${TMPDIR:-/tmp}"
  if [[ -d /dev/shm && -w /dev/shm ]]; then
    temp_root="/dev/shm"
  fi
  work_dir="$(mktemp -d "${temp_root%/}/personal-finance-operation.XXXXXX")"
  chmod 700 "$work_dir"
}

preview_names() {
  require_value PR_NUMBER
  [[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]] || fail "PR_NUMBER must be a positive integer"
  preview_slug="pr-$PR_NUMBER"
  worker_name="personal-finance-api-$preview_slug"
  access_name="Personal Finance API $preview_slug"
  preview_host="$worker_name.${CLOUDFLARE_WORKERS_SUBDOMAIN:-missing}.workers.dev"
  context_path="$runtime_root/$preview_slug.json"
}

write_bearer_config() {
  local path="$1"
  local token="$2"
  printf 'header = "Authorization: Bearer %s"\n' "$token" >"$path"
  chmod 600 "$path"
}

request_json() {
  local auth_config="$1"
  local output="$2"
  shift 2
  curl --disable --config "$auth_config" --connect-timeout 10 --fail --max-time 60 \
    --silent --show-error --output "$output" "$@"
  chmod 600 "$output"
}

require_cloudflare_response() {
  local response="$1"
  jq -e '.success == true' "$response" >/dev/null || fail "Cloudflare rejected the request"
}

load_preview_context() {
  preview_names
  [[ -f "$context_path" ]] || fail "preview runtime context is missing for $preview_slug"
  chmod 600 "$context_path"
}

preview_provision() {
  preview_names
  require_values CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN CLOUDFLARE_WORKERS_SUBDOMAIN \
    CF_ACCESS_SERVICE_TOKEN_ID NEON_API_KEY PERSONAL_FINANCE_DATABASE_NAME \
    PERSONAL_FINANCE_DATABASE_ROLE PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID
  finish_check preview-provision && return
  require_command curl
  require_command jq
  make_work_dir
  write_bearer_config "$work_dir/neon.curl" "$NEON_API_KEY"
  write_bearer_config "$work_dir/cloudflare.curl" "$CLOUDFLARE_API_TOKEN"

  request_json "$work_dir/neon.curl" "$work_dir/branches.json" --get \
    --url "https://console.neon.tech/api/v2/projects/$PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID/branches" \
    --data-urlencode "limit=100"
  branch_count="$(jq --arg name "$preview_slug" '[.branches[]? | select(.name == $name)] | length' "$work_dir/branches.json")"
  [[ "$branch_count" =~ ^[01]$ ]] || fail "Neon returned duplicate preview branches for $preview_slug"
  if [[ "$branch_count" == "0" ]]; then
    jq -n --arg name "$preview_slug" '{branch: {name: $name}}' >"$work_dir/create-branch.json"
    request_json "$work_dir/neon.curl" "$work_dir/created-branch.json" --request POST \
      --url "https://console.neon.tech/api/v2/projects/$PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID/branches" \
      --header "Content-Type: application/json" --data-binary "@$work_dir/create-branch.json"
    branch_id="$(jq -er '.branch.id' "$work_dir/created-branch.json")"
  else
    branch_id="$(jq -er --arg name "$preview_slug" '.branches[] | select(.name == $name) | .id' "$work_dir/branches.json")"
  fi

  database_url=""
  for attempt in 1 2 3 4 5 6; do
    if request_json "$work_dir/neon.curl" "$work_dir/connection.json" --get \
      --url "https://console.neon.tech/api/v2/projects/$PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID/connection_uri" \
      --data-urlencode "branch_id=$branch_id" \
      --data-urlencode "database_name=$PERSONAL_FINANCE_DATABASE_NAME" \
      --data-urlencode "role_name=$PERSONAL_FINANCE_DATABASE_ROLE" \
      --data-urlencode "pooled=false"; then
      database_url="$(jq -er '.uri | select(type == "string" and length > 0)' "$work_dir/connection.json" 2>/dev/null || true)"
      if [[ -n "$database_url" ]]; then
        break
      fi
    fi
    sleep 5
  done
  [[ -n "$database_url" ]] || fail "Neon did not return the preview connection URI"

  request_json "$work_dir/cloudflare.curl" "$work_dir/apps.json" --get \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" \
    --data-urlencode "per_page=100"
  require_cloudflare_response "$work_dir/apps.json"
  app_count="$(jq --arg name "$access_name" '[.result[]? | select(.name == $name)] | length' "$work_dir/apps.json")"
  [[ "$app_count" =~ ^[01]$ ]] || fail "Cloudflare returned duplicate Access applications for $preview_slug"
  if [[ "$app_count" == "0" ]]; then
    jq -n --arg name "$access_name" --arg domain "$preview_host" \
      '{name: $name, domain: $domain, type: "self_hosted", session_duration: "1h"}' \
      >"$work_dir/create-app.json"
    request_json "$work_dir/cloudflare.curl" "$work_dir/created-app.json" --request POST \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" \
      --header "Content-Type: application/json" --data-binary "@$work_dir/create-app.json"
    require_cloudflare_response "$work_dir/created-app.json"
    access_id="$(jq -er '.result.id' "$work_dir/created-app.json")"
    access_aud="$(jq -er '.result.aud' "$work_dir/created-app.json")"
  else
    existing_domain="$(jq -er --arg name "$access_name" '.result[] | select(.name == $name) | .domain' "$work_dir/apps.json")"
    [[ "$existing_domain" == "$preview_host" ]] || fail "existing Access application has an unexpected domain"
    access_id="$(jq -er --arg name "$access_name" '.result[] | select(.name == $name) | .id' "$work_dir/apps.json")"
    access_aud="$(jq -er --arg name "$access_name" '.result[] | select(.name == $name) | .aud' "$work_dir/apps.json")"
  fi

  request_json "$work_dir/cloudflare.curl" "$work_dir/policies.json" --get \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$access_id/policies" \
    --data-urlencode "per_page=100"
  require_cloudflare_response "$work_dir/policies.json"
  policy_count="$(jq '[.result[]? | select(.name == "Preview canary service token")] | length' "$work_dir/policies.json")"
  [[ "$policy_count" =~ ^[01]$ ]] || fail "Cloudflare returned duplicate preview service-token policies"
  if [[ "$policy_count" == "1" ]]; then
    jq -e --arg token_id "$CF_ACCESS_SERVICE_TOKEN_ID" '
      any(.result[]?;
        .name == "Preview canary service token"
        and .decision == "non_identity"
        and any(.include[]?; .service_token.token_id == $token_id)
      )
    ' "$work_dir/policies.json" >/dev/null \
      || fail "existing preview Access policy does not use the declared service token"
  fi
  if [[ "$policy_count" == "0" ]]; then
    jq -n --arg token_id "$CF_ACCESS_SERVICE_TOKEN_ID" '{
      name: "Preview canary service token",
      decision: "non_identity",
      precedence: 1,
      include: [{service_token: {token_id: $token_id}}]
    }' >"$work_dir/create-policy.json"
    request_json "$work_dir/cloudflare.curl" "$work_dir/created-policy.json" --request POST \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$access_id/policies" \
      --header "Content-Type: application/json" --data-binary "@$work_dir/create-policy.json"
    require_cloudflare_response "$work_dir/created-policy.json"
  fi

  mkdir -p "$runtime_root"
  jq -n --arg preview "$preview_slug" --arg branch_id "$branch_id" \
    --arg database_url "$database_url" --arg access_id "$access_id" \
    --arg access_aud "$access_aud" --arg worker_name "$worker_name" \
    --arg url "https://$preview_host" '{
      preview: $preview,
      neon_branch_id: $branch_id,
      database_url: $database_url,
      access_application_id: $access_id,
      access_aud: $access_aud,
      worker_name: $worker_name,
      url: $url
    }' >"$context_path"
  chmod 600 "$context_path"
  echo "Provisioned isolated provider resources for $preview_slug."
}

preview_migrate() {
  preview_names
  finish_check preview-migrate && return
  load_preview_context
  database_url="$(jq -er '.database_url' "$context_path")"
  DATABASE_URL="$database_url" mise //packages/personal-finance-data:db:migrate
}

preview_seed() {
  preview_names
  finish_check preview-seed && return
  load_preview_context
  require_command docker
  database_url="$(jq -er '.database_url' "$context_path")"
  docker run --rm --env PGDATABASE="$database_url" "$postgres_image" \
    psql --no-password --set ON_ERROR_STOP=1 --command \
    "INSERT INTO household_canary_record (id, owner_user_id, classification, label) VALUES ('synthetic-household-preview-canary', 'preview-canary', 'synthetic-only', 'synthetic household') ON CONFLICT (id) DO UPDATE SET classification = EXCLUDED.classification, label = EXCLUDED.label, updated_at = now();" \
    >/dev/null
  echo "Seeded the synthetic-only preview fixture."
}

write_worker_secrets() {
  local output="$1"
  local database_url="${2:-}"
  jq -n --arg auth_secret "$BETTER_AUTH_SECRET" --arg google_id "$GOOGLE_CLIENT_ID" \
    --arg google_secret "$GOOGLE_CLIENT_SECRET" --arg database_url "$database_url" \
    --arg canary_token "${CANARY_PREVIEW_AUTH_TOKEN:-}" '{
      BETTER_AUTH_SECRET: $auth_secret,
      GOOGLE_CLIENT_ID: $google_id,
      GOOGLE_CLIENT_SECRET: $google_secret
    }
    + (if $database_url == "" then {} else {DATABASE_URL: $database_url} end)
    + (if $canary_token == "" then {} else {CANARY_PREVIEW_AUTH_TOKEN: $canary_token} end)
  ' >"$output"
  chmod 600 "$output"
}

preview_deploy() {
  preview_names
  require_values BETTER_AUTH_SECRET CANARY_PREVIEW_AUTH_TOKEN GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  finish_check preview-deploy && return
  load_preview_context
  [[ -x "$worker_root/node_modules/.bin/wrangler" ]] || fail "Worker dependencies are not installed"
  make_work_dir
  database_url="$(jq -er '.database_url' "$context_path")"
  preview_url="$(jq -er '.url' "$context_path")"
  write_worker_secrets "$work_dir/secrets.json" "$database_url"
  "$worker_root/node_modules/.bin/wrangler" deploy --cwd "$worker_root" \
    --config "$worker_root/wrangler.toml" --name "$worker_name" \
    --var "DEPLOYMENT_ENV:preview" --var "BETTER_AUTH_URL:$preview_url" \
    --secrets-file "$work_dir/secrets.json"
  echo "Deployed isolated Worker $worker_name."
}

posthog_capture() {
  local event="$1"
  local correlation_id="$2"
  local deployment="${3:-preview}"
  require_values POSTHOG_HOST POSTHOG_WRITE_KEY
  jq -n --arg api_key "$POSTHOG_WRITE_KEY" --arg event "$event" \
    --arg correlation_id "$correlation_id" --arg deployment "$deployment" '{
      api_key: $api_key,
      event: $event,
      properties: {
        distinct_id: "preview-canary",
        deployment: $deployment,
        classification: "synthetic-only",
        correlation_id: $correlation_id
      }
    }' >"$work_dir/posthog-capture.json"
  curl --connect-timeout 10 --fail --max-time 30 --silent --show-error \
    --output "$work_dir/posthog-captured.json" --request POST \
    --url "${POSTHOG_HOST%/}/capture/" --header "Content-Type: application/json" \
    --data-binary "@$work_dir/posthog-capture.json"
}

preview_smoke() {
  preview_names
  require_values CANARY_PREVIEW_AUTH_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET \
    POSTHOG_HOST POSTHOG_WRITE_KEY
  finish_check preview-smoke && return
  load_preview_context
  require_command curl
  require_command jq
  make_work_dir
  preview_url="$(jq -er '.url' "$context_path")"
  common_headers=(
    --header "Authorization: Bearer $CANARY_PREVIEW_AUTH_TOKEN"
    --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID"
    --header "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
  )
  curl --connect-timeout 10 --fail --max-time 30 --silent --show-error \
    --output "$work_dir/write.json" --request PUT "${common_headers[@]}" \
    --header "Content-Type: application/json" --url "$preview_url/api/canary/household" \
    --data '{"label":"synthetic household"}'
  curl --connect-timeout 10 --fail --max-time 30 --silent --show-error \
    --output "$work_dir/read.json" "${common_headers[@]}" \
    --url "$preview_url/api/canary/household"
  jq -e '.classification == "synthetic-only" and .label == "synthetic household" and (.id | startswith("synthetic-household-"))' \
    "$work_dir/write.json" "$work_dir/read.json" >/dev/null || fail "preview canary response was invalid"
  correlation_id="$(git -C "$repository_root" rev-parse --short=12 HEAD)-$preview_slug"
  posthog_capture "personal_finance_preview_canary" "$correlation_id"
  jq --arg correlation_id "$correlation_id" '. + {telemetry_correlation_id: $correlation_id}' \
    "$context_path" >"$work_dir/context.json"
  mv "$work_dir/context.json" "$context_path"
  chmod 600 "$context_path"
  echo "Authenticated synthetic preview create/read smoke passed."
}

preview_telemetry() {
  preview_names
  require_values POSTHOG_HOST POSTHOG_PERSONAL_API_KEY POSTHOG_PROJECT_ID
  finish_check preview-telemetry && return
  load_preview_context
  require_command curl
  require_command jq
  make_work_dir
  correlation_id="$(jq -er '.telemetry_correlation_id' "$context_path")"
  write_bearer_config "$work_dir/posthog.curl" "$POSTHOG_PERSONAL_API_KEY"
  for attempt in 1 2 3 4 5 6; do
    request_json "$work_dir/posthog.curl" "$work_dir/events.json" --get \
      --url "${POSTHOG_HOST%/}/api/projects/$POSTHOG_PROJECT_ID/events/" \
      --data-urlencode "event=personal_finance_preview_canary" \
      --data-urlencode "limit=20"
    if jq -e --arg correlation_id "$correlation_id" \
      'any(.results[]?; .properties.correlation_id == $correlation_id and .properties.classification == "synthetic-only")' \
      "$work_dir/events.json" >/dev/null; then
      echo "Verified redacted preview telemetry for correlation $correlation_id."
      return
    fi
    sleep 5
  done
  fail "PostHog did not return the preview telemetry correlation"
}

preview_cleanup() {
  preview_names
  require_values CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN CLOUDFLARE_WORKERS_SUBDOMAIN \
    NEON_API_KEY PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID
  finish_check preview-cleanup && return
  require_command curl
  require_command jq
  make_work_dir
  write_bearer_config "$work_dir/neon.curl" "$NEON_API_KEY"
  write_bearer_config "$work_dir/cloudflare.curl" "$CLOUDFLARE_API_TOKEN"

  request_json "$work_dir/cloudflare.curl" "$work_dir/services.json" --get \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/services" \
    --data-urlencode "per_page=100"
  require_cloudflare_response "$work_dir/services.json"
  if jq -e --arg name "$worker_name" 'any(.result[]?; .id == $name or .name == $name)' "$work_dir/services.json" >/dev/null; then
    request_json "$work_dir/cloudflare.curl" "$work_dir/deleted-worker.json" --request DELETE \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/services/$worker_name"
    require_cloudflare_response "$work_dir/deleted-worker.json"
  fi

  request_json "$work_dir/cloudflare.curl" "$work_dir/apps.json" --get \
    --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" \
    --data-urlencode "per_page=100"
  require_cloudflare_response "$work_dir/apps.json"
  while IFS= read -r access_id; do
    request_json "$work_dir/cloudflare.curl" "$work_dir/deleted-app-$access_id.json" --request DELETE \
      --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$access_id"
    require_cloudflare_response "$work_dir/deleted-app-$access_id.json"
  done < <(jq -r --arg name "$access_name" '.result[]? | select(.name == $name) | .id' "$work_dir/apps.json")

  request_json "$work_dir/neon.curl" "$work_dir/branches.json" --get \
    --url "https://console.neon.tech/api/v2/projects/$PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID/branches" \
    --data-urlencode "limit=100"
  while IFS= read -r branch_id; do
    request_json "$work_dir/neon.curl" "$work_dir/deleted-branch-$branch_id.json" --request DELETE \
      --url "https://console.neon.tech/api/v2/projects/$PERSONAL_FINANCE_PREVIEW_NEON_PROJECT_ID/branches/$branch_id"
  done < <(jq -r --arg name "$preview_slug" '.branches[]? | select(.name == $name) | .id' "$work_dir/branches.json")

  if [[ -f "$context_path" ]]; then
    : >"$context_path"
    unlink "$context_path"
  fi
  echo "Preview cleanup completed for $preview_slug."
}

production_migrate() {
  require_value PRODUCTION_DATABASE_URL
  finish_check production-migrate && return
  DATABASE_URL="$PRODUCTION_DATABASE_URL" mise //packages/personal-finance-data:db:migrate
}

production_deploy() {
  require_values BETTER_AUTH_SECRET CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN GOOGLE_CLIENT_ID \
    GOOGLE_CLIENT_SECRET PERSONAL_FINANCE_HYPERDRIVE_ID PERSONAL_FINANCE_PRODUCTION_URL
  finish_check production-deploy && return
  [[ -x "$worker_root/node_modules/.bin/wrangler" ]] || fail "Worker dependencies are not installed"
  make_work_dir
  cp "$worker_root/wrangler.toml" "$work_dir/wrangler.toml"
  cat >>"$work_dir/wrangler.toml" <<EOF

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "$PERSONAL_FINANCE_HYPERDRIVE_ID"
EOF
  write_worker_secrets "$work_dir/secrets.json" ""
  "$worker_root/node_modules/.bin/wrangler" deploy --cwd "$worker_root" \
    --config "$work_dir/wrangler.toml" --name "personal-finance-api" \
    --var "DEPLOYMENT_ENV:production" --var "BETTER_AUTH_URL:$PERSONAL_FINANCE_PRODUCTION_URL" \
    --secrets-file "$work_dir/secrets.json"
}

production_smoke() {
  require_value PERSONAL_FINANCE_PRODUCTION_URL
  finish_check production-smoke && return
  make_work_dir
  curl --connect-timeout 10 --fail --max-time 30 --silent --show-error \
    --output "$work_dir/health.json" --url "${PERSONAL_FINANCE_PRODUCTION_URL%/}/health"
  jq -e '.status == "ok"' "$work_dir/health.json" >/dev/null || fail "production health response was invalid"
  status="$(curl --connect-timeout 10 --max-time 30 --silent --show-error \
    --output "$work_dir/unauthenticated.json" --write-out '%{http_code}' \
    --url "${PERSONAL_FINANCE_PRODUCTION_URL%/}/api/canary/household")"
  [[ "$status" == "401" ]] || fail "production canary route did not reject an unauthenticated request"
  echo "Production health passed and the project route rejected an unauthenticated request."
}

production_rollback() {
  require_values PERSONAL_FINANCE_ROLLBACK_GIT_REVISION PERSONAL_FINANCE_ROLLBACK_VERSION_ID ROLLBACK_REVISION
  [[ "$ROLLBACK_REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "ROLLBACK_REVISION must be a full Git revision"
  [[ "$ROLLBACK_REVISION" == "$PERSONAL_FINANCE_ROLLBACK_GIT_REVISION" ]] || fail "rollback revision does not match the reviewed Worker version mapping"
  finish_check production-rollback && return
  [[ -x "$worker_root/node_modules/.bin/wrangler" ]] || fail "Worker dependencies are not installed"
  "$worker_root/node_modules/.bin/wrangler" versions deploy \
    "$PERSONAL_FINANCE_ROLLBACK_VERSION_ID@100%" --cwd "$worker_root" \
    --config "$worker_root/wrangler.toml" --name personal-finance-api --yes
}

backup_create() {
  require_values AGE_RECIPIENT CLOUDFLARE_ACCOUNT_ID NEON_DATABASE_URL_UNPOOLED \
    R2_ACCESS_KEY_ID R2_DATABASE_BACKUPS_BUCKET_NAME R2_SECRET_ACCESS_KEY
  finish_check backup-create && return
  DATABASE_BACKUP_LABEL="personal-finance" mise //backups:backup
}

restore_drill() {
  require_values AGE_IDENTITY_FILE CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID \
    R2_DATABASE_BACKUPS_BUCKET_NAME R2_SECRET_ACCESS_KEY RESTORE_DATABASE_URL \
    RESTORE_DRILL_ID RESTORE_OBJECT_KEY RESTORE_TARGET_CLASS
  [[ "$RESTORE_TARGET_CLASS" == "scratch" ]] || fail "RESTORE_TARGET_CLASS must be scratch"
  [[ "$RESTORE_DRILL_ID" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || fail "RESTORE_DRILL_ID is invalid"
  [[ -f "$AGE_IDENTITY_FILE" ]] || fail "AGE_IDENTITY_FILE must name a mounted recovery key"
  [[ "$RESTORE_DATABASE_URL" != "${NEON_DATABASE_URL_UNPOOLED:-}" ]] || fail "restore target must differ from production"
  finish_check restore-drill && return
  require_command age
  require_command aws
  require_command docker
  make_work_dir
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  export AWS_EC2_METADATA_DISABLED="true"
  endpoint="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  archive="$work_dir/backup.dump.age"
  checksum="$work_dir/backup.dump.age.sha256"
  aws s3 cp "s3://$R2_DATABASE_BACKUPS_BUCKET_NAME/$RESTORE_OBJECT_KEY" "$archive" \
    --endpoint-url "$endpoint" --no-progress --only-show-errors
  aws s3 cp "s3://$R2_DATABASE_BACKUPS_BUCKET_NAME/$RESTORE_OBJECT_KEY.sha256" "$checksum" \
    --endpoint-url "$endpoint" --no-progress --only-show-errors
  expected="$(cut -d ' ' -f 1 "$checksum")"
  actual="$(sha256sum "$archive" | cut -d ' ' -f 1)"
  [[ "$expected" == "$actual" ]] || fail "backup ciphertext checksum mismatch"
  age --decrypt --identity "$AGE_IDENTITY_FILE" "$archive" \
    | docker run --rm --interactive --env PGDATABASE="$RESTORE_DATABASE_URL" "$postgres_image" \
      pg_restore --dbname "$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error
  docker run --rm --env PGDATABASE="$RESTORE_DATABASE_URL" "$postgres_image" \
    psql --no-password --set ON_ERROR_STOP=1 --tuples-only --command \
    "SELECT count(*) FROM household_canary_record WHERE classification = 'synthetic-only';" >/dev/null
  echo "Scratch restore drill $RESTORE_DRILL_ID passed archive and schema checks."
}

alert_smoke() {
  require_values POSTHOG_HOST POSTHOG_PERSONAL_API_KEY POSTHOG_PROJECT_ID POSTHOG_WRITE_KEY
  finish_check alert-smoke && return
  make_work_dir
  correlation_id="alert-$(git -C "$repository_root" rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
  posthog_capture "personal_finance_synthetic_alert" "$correlation_id" "production"
  write_bearer_config "$work_dir/posthog.curl" "$POSTHOG_PERSONAL_API_KEY"
  for attempt in 1 2 3 4 5 6; do
    request_json "$work_dir/posthog.curl" "$work_dir/events.json" --get \
      --url "${POSTHOG_HOST%/}/api/projects/$POSTHOG_PROJECT_ID/events/" \
      --data-urlencode "event=personal_finance_synthetic_alert" --data-urlencode "limit=20"
    if jq -e --arg correlation_id "$correlation_id" \
      'any(.results[]?; .properties.correlation_id == $correlation_id and .properties.classification == "synthetic-only")' \
      "$work_dir/events.json" >/dev/null; then
      echo "Synthetic alert event reached PostHog with correlation $correlation_id."
      return
    fi
    sleep 5
  done
  fail "PostHog did not return the synthetic alert correlation"
}

require_command jq
require_command mise

case "${1:-}" in
  preview-provision) preview_provision ;;
  preview-migrate) preview_migrate ;;
  preview-seed) preview_seed ;;
  preview-deploy) preview_deploy ;;
  preview-smoke) preview_smoke ;;
  preview-telemetry) preview_telemetry ;;
  preview-cleanup) preview_cleanup ;;
  production-migrate) production_migrate ;;
  production-deploy) production_deploy ;;
  production-smoke) production_smoke ;;
  production-rollback) production_rollback ;;
  backup-create) backup_create ;;
  restore-drill) restore_drill ;;
  alert-smoke) alert_smoke ;;
  *)
    echo "Usage: provider-operation.sh <preview-provision|preview-migrate|preview-seed|preview-deploy|preview-smoke|preview-telemetry|preview-cleanup|production-migrate|production-deploy|production-smoke|production-rollback|backup-create|restore-drill|alert-smoke>" >&2
    exit 2
    ;;
esac
