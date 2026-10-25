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
    gh api repos/Robbie-Palmer/hq --jq ".permissions.push" \
      | grep -Fx true >/dev/null
    git config --global --get-all credential.https://github.com.helper \
      | grep -F "gh auth git-credential" >/dev/null
    test -n "${DOPPLER_TOKEN:-}"
    for project in ai-review homelab personal-site work-graph; do
      doppler secrets --project "${project}" --config dev --only-names \
        >/dev/null
    done
  '

echo "Vector T3 GitHub and development-only Doppler access are healthy"
