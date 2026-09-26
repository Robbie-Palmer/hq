#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

required_values=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  DOPPLER_CONFIG
  DOPPLER_PROJECT
  NEON_API_KEY
  NEON_BRANCH_ID
  NEON_DATABASE_HOST
  NEON_DATABASE_NAME
  NEON_PROJECT_ID
  NEON_ROLE_NAME
  WORK_GRAPH_API_ORIGIN
  WORK_GRAPH_DOPPLER_SERVICE_TOKEN
  WORK_GRAPH_HYPERDRIVE_ID
  WORK_GRAPH_HYPERDRIVE_NAME
)
for name in "${required_values[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Cannot install the Work Graph Hyperdrive origin: $name is required." >&2
    exit 1
  fi
done

secrets_root="${TMPDIR:-/tmp}"
if [[ -d /dev/shm && -w /dev/shm ]]; then
  secrets_root="/dev/shm"
fi
work_dir="$(mktemp -d "${secrets_root%/}/work-graph-hyperdrive.XXXXXX")"
chmod 700 "$work_dir"
cleanup() {
  find "$work_dir" -type f -exec unlink {} + 2>/dev/null || true
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'header = "Authorization: Bearer %s"\n' "$NEON_API_KEY" >"$work_dir/neon.curl"
printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" >"$work_dir/cloudflare.curl"
printf 'header = "Authorization: Bearer %s"\n' "$WORK_GRAPH_DOPPLER_SERVICE_TOKEN" >"$work_dir/doppler.curl"

curl --disable --config "$work_dir/neon.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/password.json" \
  --url "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$NEON_BRANCH_ID/roles/$NEON_ROLE_NAME/reveal_password"
if ! jq -e '.password | type == "string" and length > 0' "$work_dir/password.json" >/dev/null; then
  echo "Neon did not return the Work Graph database password." >&2
  exit 1
fi

jq -n \
  --arg database "$NEON_DATABASE_NAME" \
  --arg host "$NEON_DATABASE_HOST" \
  --arg name "$WORK_GRAPH_HYPERDRIVE_NAME" \
  --arg user "$NEON_ROLE_NAME" \
  --slurpfile credential "$work_dir/password.json" \
  '{
    name: $name,
    origin: {
      database: $database,
      host: $host,
      port: 5432,
      user: $user,
      password: $credential[0].password,
      scheme: "postgresql"
    },
    caching: {disabled: true}
  }' >"$work_dir/hyperdrive-update.json"
curl --disable --config "$work_dir/cloudflare.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/hyperdrive-updated.json" \
  --request PUT \
  --url "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs/$WORK_GRAPH_HYPERDRIVE_ID" \
  --header "Content-Type: application/json" \
  --data-binary "@$work_dir/hyperdrive-update.json"
if [[ "$(jq -er '.success' "$work_dir/hyperdrive-updated.json")" != true ]]; then
  echo "Cloudflare did not accept the Work Graph Hyperdrive origin." >&2
  exit 1
fi

jq -jrn \
  --arg database "$NEON_DATABASE_NAME" \
  --arg host "$NEON_DATABASE_HOST" \
  --arg user "$NEON_ROLE_NAME" \
  --slurpfile credential "$work_dir/password.json" \
  '($user | @uri) as $encoded_user
  | ($credential[0].password | @uri) as $encoded_password
  | ($database | @uri) as $encoded_database
  | "postgresql://\($encoded_user):\($encoded_password)@\($host):5432/\($encoded_database)?sslmode=require"' \
  >"$work_dir/database-url.txt"
jq -n \
  --arg project "$DOPPLER_PROJECT" \
  --arg config "$DOPPLER_CONFIG" \
  --arg hyperdrive_id "$WORK_GRAPH_HYPERDRIVE_ID" \
  --arg api_origin "$WORK_GRAPH_API_ORIGIN" \
  --rawfile database_url "$work_dir/database-url.txt" \
  '{
    project: $project,
    config: $config,
    secrets: {
      DATABASE_URL: $database_url,
      WORK_GRAPH_HYPERDRIVE_ID: $hyperdrive_id,
      WORK_GRAPH_API_URL: $api_origin,
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: $api_origin
    }
  }' >"$work_dir/doppler-update.json"
curl --disable --config "$work_dir/doppler.curl" --connect-timeout 10 --fail --max-time 30 \
  --silent --show-error --output "$work_dir/doppler-updated.json" \
  --request POST \
  --url "https://api.doppler.com/v3/configs/config/secrets" \
  --header "Content-Type: application/json" \
  --data-binary "@$work_dir/doppler-update.json"

echo "Installed the Neon origin in Hyperdrive and recorded its public ID in Doppler."
