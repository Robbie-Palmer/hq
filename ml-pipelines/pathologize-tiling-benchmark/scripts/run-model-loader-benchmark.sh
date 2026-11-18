#!/usr/bin/env bash
set -euo pipefail

project_root=$(git rev-parse --show-toplevel)
registry_root=${project_root}/ml-pipelines/pathologize-data-registry
fixture_root=${registry_root}/data/raw/cptac-coad-idc/v23/b117aabf-c225-432e-95af-8ee9247a1ad6
fixture_manifest=${registry_root}/manifests/assets/cptac-coad-idc-v23-smallest-series.json
collection_manifest=${registry_root}/manifests/collections/cptac-coad-idc.json

uv run --locked --extra cuda --extra model pathologize-model-loader-benchmark run \
  --fixture-root="${fixture_root}" \
  --fixture-manifest="${fixture_manifest}" \
  --fixture-collection-manifest="${collection_manifest}" \
  "$@"
