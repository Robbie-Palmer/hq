#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
context=${VECTOR_DEVELOPMENT_KUBE_CONTEXT:-vector-development}
export KUBECONFIG="${VECTOR_DEVELOPMENT_KUBECONFIG:-${homelab_dir}/.kube/vector-development.yaml}"

if [[ ! -t 0 ]]; then
  echo "Run this task from an interactive terminal so credentials remain hidden" >&2
  exit 1
fi

for command_name in doppler jq kubectl node; do
  command -v "${command_name}" >/dev/null
done

"${script_dir}/require-kube-context.sh" "${context}" home
doppler me --json >/dev/null

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
old_pod_uid=$(
  kubectl --context "${context}" --namespace t3-code get pod "${pod}" \
    --output=jsonpath='{.metadata.uid}'
)

set +e
kubectl --context "${context}" --namespace t3-code exec --stdin "${pod}" \
  --container t3-code -- node --input-type=module - \
  <"${script_dir}/check-t3-idle.mjs"
idle_status=$?
set -e
if [[ "${idle_status}" -eq 20 ]]; then
  echo "Vector has active T3 work; credentials were not changed" >&2
  exit 1
fi
if [[ "${idle_status}" -ne 0 ]]; then
  echo "The T3 idle check failed; credentials were not changed" >&2
  exit "${idle_status}"
fi

github_token=
doppler_token=
credential_revision=
cleanup() {
  unset github_token doppler_token credential_revision
}
trap cleanup EXIT

read -r -s -p "GitHub fine-grained token for Robbie-Palmer/hq: " github_token
printf '\n'
read -r -s -p "Doppler vector-development-t3 service-account token: " doppler_token
printf '\n'
if [[ -z "${github_token}" || -z "${doppler_token}" ]]; then
  echo "Both credentials are required" >&2
  exit 1
fi
credential_revision=$(date -u +%Y%m%dT%H%M%SZ)-$$

doppler secrets upload \
  <(
    jq -n \
      --rawfile github_token <(printf '%s' "${github_token}") \
      --rawfile doppler_token <(printf '%s' "${doppler_token}") \
      --arg credential_revision "${credential_revision}" \
      '{
        GH_TOKEN: $github_token,
        DOPPLER_TOKEN: $doppler_token,
        AGENT_CREDENTIALS_REVISION: $credential_revision
      }'
  ) \
  --project homelab \
  --config prd_vector_development \
  --silent >/dev/null
unset github_token doppler_token

for _ in $(seq 1 180); do
  if kubectl --context "${context}" --namespace t3-code \
    get secret t3-code-runtime --output=json \
    | jq -e --arg credential_revision "${credential_revision}" '
        ((.data.AGENT_CREDENTIALS_REVISION // "") | @base64d)
          == $credential_revision
      ' >/dev/null; then
    break
  fi
  sleep 2
done

kubectl --context "${context}" --namespace t3-code get secret t3-code-runtime \
  --output=json \
  | jq -e --arg credential_revision "${credential_revision}" '
      ((.data.AGENT_CREDENTIALS_REVISION // "") | @base64d)
        == $credential_revision
    ' >/dev/null

replacement_pod=
for _ in $(seq 1 150); do
  replacement_pod=$(
    kubectl --context "${context}" --namespace t3-code get pods \
      --selector=app.kubernetes.io/name=t3-code \
      --output=json \
      | jq -r --arg old_pod_uid "${old_pod_uid}" '
          [.items[]
            | select(.metadata.uid != $old_pod_uid)
            | select(.status.phase == "Running")
            | select(any(.status.conditions[]?; .type == "Ready" and .status == "True"))]
          | sort_by(.metadata.creationTimestamp)
          | last
          | .metadata.name // empty
        '
  )
  if [[ -n "${replacement_pod}" ]] \
    && kubectl --context "${context}" --namespace t3-code \
      exec "${replacement_pod}" --container t3-code -- \
      sh -eu -c 'test "${AGENT_CREDENTIALS_REVISION:-}" = "$1"' \
      _ "${credential_revision}" >/dev/null 2>&1; then
    break
  fi
  replacement_pod=
  sleep 2
done
if [[ -z "${replacement_pod}" ]]; then
  echo "The credential revision synced, but no replacement Vector T3 pod loaded it" >&2
  exit 1
fi

kubectl --context "${context}" --namespace t3-code rollout status \
  deployment/t3-code --timeout=10m
kubectl --context "${context}" --namespace t3-code exec "${replacement_pod}" \
  --container t3-code -- gh auth setup-git --hostname github.com --force

"${script_dir}/vector-development-agent-auth-health.sh"
