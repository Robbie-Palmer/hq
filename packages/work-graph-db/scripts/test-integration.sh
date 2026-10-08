#!/usr/bin/env bash
set -euo pipefail

container_id=""
container_name=""

cleanup() {
  container_ref="${container_id:-$container_name}"
  if [[ -n "$container_ref" ]]; then
    integration_label=$(
      docker inspect \
        --format '{{ index .Config.Labels "personal-site.work-graph-integration" }}' \
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
    echo "The integration suite truncates Work Graph tables." >&2
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

  db_password="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"
  container_name="personal-site-work-graph-integration-$$"
  container_id=$(docker run --detach --rm \
    --name "$container_name" \
    --env POSTGRES_DB=work_graph_integration \
    --env POSTGRES_PASSWORD="$db_password" \
    --label personal-site.work-graph-integration=true \
    --publish 127.0.0.1::5432 \
    postgres:17-alpine)
  if [[ ! "$container_id" =~ ^[a-f0-9]{12,64}$ ]]; then
    echo "Docker returned an invalid container ID." >&2
    exit 1
  fi

  for attempt in {1..30}; do
    if docker exec "$container_id" pg_isready \
      --username postgres \
      --dbname work_graph_integration >/dev/null 2>&1; then
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
  export DATABASE_URL="postgresql://postgres:${db_password}@127.0.0.1:${published_port}/work_graph_integration"
fi

pnpm db:migrate
pnpm exec vitest run --config vitest.integration.config.ts "$@"
