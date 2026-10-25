#!/usr/bin/env bash
set -euo pipefail

expected_context=${1:?expected Kubernetes context is required}
expected_location=${2:?expected homelab.dev/location value is required}
actual_context=$(kubectl config current-context)

echo "Kubernetes context: ${actual_context}"
if [ "${actual_context}" != "${expected_context}" ]; then
  echo "refusing to target '${actual_context}', expected '${expected_context}'" >&2
  exit 1
fi

node_count=$(kubectl get nodes \
  --selector="homelab.dev/location=${expected_location}" \
  --output=name \
  | wc -l)
if [ "${node_count}" -lt 1 ]; then
  echo "context has no node labelled homelab.dev/location=${expected_location}" >&2
  exit 1
fi

wrong_location_count=$(kubectl get nodes \
  --selector="homelab.dev/location!=${expected_location}" \
  --output=name \
  | wc -l)
if [ "${wrong_location_count}" -ne 0 ]; then
  echo "context contains a node from another location; refusing to continue" >&2
  exit 1
fi
