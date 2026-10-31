#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
source versions.env
docker build \
  --file conformance.Dockerfile \
  --build-arg "CONFORMANCE_BUILDER_IMAGE=$CONFORMANCE_BUILDER_IMAGE" \
  --build-arg "CONFORMANCE_COMMIT=$CONFORMANCE_COMMIT" \
  --tag "oci-registry-spike-conformance:$CONFORMANCE_COMMIT" \
  .

[[ "$(docker image inspect "oci-registry-spike-conformance:$CONFORMANCE_COMMIT" --format '{{.Config.User}}')" == "65532:65532" ]]

