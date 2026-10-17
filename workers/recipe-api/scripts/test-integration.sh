#!/usr/bin/env bash
set -euo pipefail

container_id=""
container_name=""
migration_recovery_database=""
migration_recovery_url=""

cleanup() {
  container_ref="${container_id:-$container_name}"
  if [[ -n "$container_ref" ]]; then
    integration_label=$(
      docker inspect \
        --format '{{ index .Config.Labels "personal-site.recipe-api-integration" }}' \
        "$container_ref" 2>/dev/null || true
    )
    if [[ "$integration_label" == "true" ]]; then
      docker rm --force "$container_ref" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT INT TERM

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  if [[ "${ALLOW_INTEGRATION_DATABASE:-}" != "1" ]]; then
    echo "ALLOW_INTEGRATION_DATABASE=1 is required with TEST_DATABASE_URL." >&2
    echo "The integration suite truncates application tables." >&2
    exit 1
  fi
  export DATABASE_URL="$TEST_DATABASE_URL"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required when TEST_DATABASE_URL is not provided." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but its daemon is unavailable." >&2
    exit 1
  fi

  # Generate a throwaway password per run so no credential is hardcoded. The
  # container is disposable, published only on loopback, and removed on exit,
  # but keeping the secret out of source avoids it ever being reused elsewhere.
  db_password="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"

  # Set the exact cleanup target before Docker starts, so an interrupt between
  # container creation and ID capture cannot leave the labelled container behind.
  container_name="personal-site-recipe-api-integration-$$"
  container_id=$(docker run --detach --rm \
    --name "$container_name" \
    --env POSTGRES_DB=recipes_integration \
    --env POSTGRES_PASSWORD="$db_password" \
    --label personal-site.recipe-api-integration=true \
    --publish 127.0.0.1::5432 \
    postgres:17-alpine)
  if [[ ! "$container_id" =~ ^[a-f0-9]{12,64}$ ]]; then
    echo "Docker returned an invalid container ID." >&2
    exit 1
  fi

  for attempt in {1..30}; do
    if docker exec "$container_id" pg_isready \
      --host 127.0.0.1 \
      --username postgres \
      --dbname recipes_integration >/dev/null 2>&1; then
      break
    fi
    if [[ "$attempt" -eq 30 ]]; then
      echo "PostgreSQL did not become ready within 30 seconds." >&2
      exit 1
    fi
    sleep 1
  done

  published_port=$(docker inspect \
    --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' \
    "$container_id")
  if [[ ! "$published_port" =~ ^[0-9]+$ ]]; then
    echo "Could not determine the disposable PostgreSQL port." >&2
    exit 1
  fi
  export DATABASE_URL="postgresql://postgres:${db_password}@127.0.0.1:${published_port}/recipes_integration"

  # Mirror production drift where the enum exists but migration 0028 is not
  # recorded, then prove the full history can reconcile and complete.
  migration_recovery_database="recipes_migration_recovery"
  docker exec "$container_id" createdb \
    --username postgres \
    --owner postgres \
    "$migration_recovery_database"
  docker exec "$container_id" psql \
    --username postgres \
    --dbname "$migration_recovery_database" \
    --set ON_ERROR_STOP=1 \
    --command "CREATE TYPE public.leftover_storage_location AS ENUM ('fridge', 'freezer')" \
    >/dev/null
  migration_recovery_url="postgresql://postgres:${db_password}@127.0.0.1:${published_port}/${migration_recovery_database}"
fi

if [[ -n "$migration_recovery_url" ]]; then
  DATABASE_URL="$migration_recovery_url" pnpm db:migrate
  recovery_migration_count=$(docker exec "$container_id" psql \
    --username postgres \
    --dbname "$migration_recovery_database" \
    --tuples-only \
    --no-align \
    --command 'select count(*) from drizzle.__drizzle_migrations')
  if [[ "$recovery_migration_count" != "29" ]]; then
    echo "Expected the recovery database to apply all 29 migrations." >&2
    exit 1
  fi
fi

pnpm db:migrate
pnpm exec vitest run --config vitest.integration.config.ts "$@"
