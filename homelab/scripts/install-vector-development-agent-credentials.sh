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
credential_revision=$(date -u +%Y%m%dT%H%M%SZ)-$$
credentials_uploaded=false
projects=(ai-review homelab personal-site work-graph)
declare -A doppler_tokens=()
declare -A new_token_slugs=()
declare -A old_token_slugs=()
cleanup() {
  status=$?
  trap - EXIT
  unset github_token
  for project in "${projects[@]}"; do
    unset "doppler_tokens[${project}]"
  done
  if [[ "${status}" -ne 0 && "${credentials_uploaded}" != true ]]; then
    for project in "${projects[@]}"; do
      if [[ -n "${new_token_slugs[$project]:-}" ]]; then
        doppler configs tokens revoke \
          --project "${project}" \
          --config dev \
          --slug "${new_token_slugs[$project]}" \
          --silent >/dev/null 2>&1 || true
      fi
    done
  fi
  exit "${status}"
}
trap cleanup EXIT

read -r -s -p "GitHub fine-grained token for Robbie-Palmer/hq: " github_token
printf '\n'
if [[ -z "${github_token}" ]]; then
  echo "The GitHub credential is required" >&2
  exit 1
fi

for project in "${projects[@]}"; do
  token_name="vector-development-t3-${project}-dev"
  old_token_slugs[${project}]=$(
    doppler configs tokens \
      --project "${project}" \
      --config dev \
      --json \
      | jq -r --arg token_name "${token_name}" '
          .[]
          | select(.name == $token_name or (.name | startswith($token_name + "-")))
          | .slug
        '
  )
  created_token=$(
    doppler configs tokens create "${token_name}-${credential_revision}" \
      --project "${project}" \
      --config dev \
      --access read/write \
      --json
  )
  doppler_tokens[${project}]=$(
    jq -er '.token | select(type == "string" and length > 0)' <<<"${created_token}"
  )
  new_token_slugs[${project}]=$(
    jq -er '.slug | select(type == "string" and length > 0)' <<<"${created_token}"
  )
  unset created_token
done

doppler secrets upload \
  <(
    jq -n \
      --rawfile github_token <(printf '%s' "${github_token}") \
      --rawfile doppler_ai_review <(printf '%s' "${doppler_tokens[ai-review]}") \
      --rawfile doppler_homelab <(printf '%s' "${doppler_tokens[homelab]}") \
      --rawfile doppler_personal_site <(printf '%s' "${doppler_tokens[personal-site]}") \
      --rawfile doppler_work_graph <(printf '%s' "${doppler_tokens[work-graph]}") \
      --arg credential_revision "${credential_revision}" \
      '{
        GH_TOKEN: $github_token,
        DOPPLER_TOKEN_AI_REVIEW: $doppler_ai_review,
        DOPPLER_TOKEN_HOMELAB: $doppler_homelab,
        DOPPLER_TOKEN_PERSONAL_SITE: $doppler_personal_site,
        DOPPLER_TOKEN_WORK_GRAPH: $doppler_work_graph,
        AGENT_CREDENTIALS_REVISION: $credential_revision
      }'
  ) \
  --project homelab \
  --config prd_vector_development \
  --silent >/dev/null
credentials_uploaded=true
unset github_token
for project in "${projects[@]}"; do
  unset "doppler_tokens[${project}]"
done

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
  --container t3-code -- gh auth setup-git --hostname github.com

"${script_dir}/vector-development-agent-auth-health.sh"

for project in "${projects[@]}"; do
  while IFS= read -r old_token_slug; do
    if [[ -n "${old_token_slug}" ]]; then
      doppler configs tokens revoke \
        --project "${project}" \
        --config dev \
        --slug "${old_token_slug}" \
        --silent >/dev/null
    fi
  done <<<"${old_token_slugs[$project]}"
done
