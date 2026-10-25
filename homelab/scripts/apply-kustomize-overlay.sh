#!/usr/bin/env bash
set -euo pipefail

overlay=${1:?overlay path is required}
expected_context=${2:?expected Kubernetes context is required}
expected_location=${3:?expected homelab.dev/location value is required}
mode=${4:-dry-run}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

"${script_dir}/require-kube-context.sh" "${expected_context}" "${expected_location}"

case "${mode}" in
  dry-run)
    kubectl apply --server-side --dry-run=server --kustomize "${overlay}"
    ;;
  apply)
    kubectl apply --server-side --kustomize "${overlay}"
    ;;
  *)
    echo "mode must be 'dry-run' or 'apply'" >&2
    exit 1
    ;;
esac
