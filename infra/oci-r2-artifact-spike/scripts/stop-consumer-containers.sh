#!/usr/bin/env bash
set -euo pipefail

docker info >/dev/null
containers=(oci-r2-artifact-spike-zot oci-r2-artifact-spike-scrub)
for container in "${containers[@]}"; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    docker rm --force "$container" >/dev/null
  fi
done

helper_ids="$(docker ps --all --quiet --filter 'label=hq.oci-r2-canary.run')"
if [[ -n "$helper_ids" ]]; then
  xargs docker rm --force >/dev/null <<<"$helper_ids"
fi

docker info >/dev/null
for container in "${containers[@]}"; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    echo "Canary container $container remains after cleanup" >&2
    exit 1
  fi
done
remaining_helpers="$(docker ps --all --quiet --filter 'label=hq.oci-r2-canary.run')"
if [[ -n "$remaining_helpers" ]]; then
  echo "An R2 helper container remains after cleanup" >&2
  exit 1
fi
