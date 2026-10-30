#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
source versions.env

mkdir -p .state/auth .artifacts
if [[ ! -f .state/auth.env ]]; then
  registry_password="$(openssl rand -hex 24)"
  umask 077
  printf 'REGISTRY_USERNAME=%q\nREGISTRY_PASSWORD=%q\n' "spike" "$registry_password" > .state/auth.env
fi
source .state/auth.env

docker run --rm "$HTTPD_IMAGE" htpasswd -nbB "$REGISTRY_USERNAME" "$REGISTRY_PASSWORD" > .state/auth/htpasswd
chmod 600 .state/auth/htpasswd .state/auth.env

docker build --file zot.Dockerfile --build-arg "BASE_IMAGE=$ZOT_IMAGE" --tag "$ZOT_RUNTIME_IMAGE" .
docker build --file distribution.Dockerfile --build-arg "BASE_IMAGE=$DISTRIBUTION_IMAGE" --tag "$DISTRIBUTION_RUNTIME_IMAGE" .

docker compose --env-file versions.env up --detach --wait localstack
for bucket in zot-registry distribution-registry; do
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api head-bucket --bucket "$bucket" >/dev/null 2>&1 || \
    docker compose --env-file versions.env exec -T localstack \
      awslocal s3api create-bucket --bucket "$bucket" >/dev/null
done
docker compose --env-file versions.env up --detach --wait zot distribution

for endpoint in "http://localhost:${ZOT_PORT:-5101}/v2/" "http://localhost:${DISTRIBUTION_PORT:-5102}/v2/"; do
  for _ in $(seq 1 60); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --user "$REGISTRY_USERNAME:$REGISTRY_PASSWORD" "$endpoint" || true)"
    [[ "$status" == "200" ]] && break
    sleep 1
  done
  if [[ "$status" != "200" ]]; then
    echo "Registry did not become ready at $endpoint, last HTTP status was $status" >&2
    exit 1
  fi
done

echo "Disposable registries are ready on ports ${ZOT_PORT:-5101} and ${DISTRIBUTION_PORT:-5102}."

