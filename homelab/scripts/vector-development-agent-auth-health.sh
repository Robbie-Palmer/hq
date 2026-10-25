#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
context=${VECTOR_DEVELOPMENT_KUBE_CONTEXT:-vector-development}
export KUBECONFIG="${VECTOR_DEVELOPMENT_KUBECONFIG:-${homelab_dir}/.kube/vector-development.yaml}"

"${script_dir}/require-kube-context.sh" "${context}" home

pod=$(
  kubectl --context "${context}" --namespace t3-code get pods \
    --selector=app.kubernetes.io/name=t3-code \
    --output=json \
    | jq -r '
        [.items[]
          | select(.status.phase == "Running")
          | select(any(.status.conditions[]?; .type == "Ready" and .status == "True"))]
        | sort_by(.metadata.creationTimestamp)
        | last
        | .metadata.name // empty
      '
)
if [[ -z "${pod}" ]]; then
  echo "No ready Vector t3-code pod is available" >&2
  exit 1
fi

kubectl --context "${context}" --namespace t3-code exec "${pod}" \
  --container t3-code -- sh -eu -c '
    test -n "${GH_TOKEN:-}"
    gh auth status --hostname github.com >/dev/null 2>&1
    git config --global --get-all credential.https://github.com.helper \
      | grep -F "gh auth git-credential" >/dev/null
    test -n "${DOPPLER_TOKEN:-}"
    doppler secrets --project personal-site --config dev --only-names \
      >/dev/null
  '

echo "Vector T3 GitHub and development-only Doppler access are healthy"
