#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
overlay="${homelab_dir}/k3s/overlays/remote-development"
context=${REMOTE_DEVELOPMENT_KUBE_CONTEXT:-remote-development}
idle_timeout_seconds=${T3_DEPLOY_IDLE_TIMEOUT_SECONDS:-3600}
idle_poll_seconds=${T3_DEPLOY_IDLE_POLL_SECONDS:-30}
export KUBECONFIG="${REMOTE_DEVELOPMENT_KUBECONFIG:-${homelab_dir}/.kube/remote-development.yaml}"

for value_name in idle_timeout_seconds idle_poll_seconds; do
  value=${!value_name}
  case "$value" in
    ''|*[!0-9]*)
      echo "${value_name} must be a non-negative integer" >&2
      exit 1
      ;;
  esac
done
if [ "$idle_poll_seconds" -eq 0 ]; then
  echo "idle_poll_seconds must be greater than zero" >&2
  exit 1
fi

"${script_dir}/require-kube-context.sh" "$context" cloud

target_images=$(
  kubectl kustomize "$overlay" \
    | sed -n 's/^[[:space:]]*image: \(ghcr\.io\/robbie-palmer\/t3-code:[^[:space:]]*\)$/\1/p' \
    | sort -u
)
if [ "$(printf '%s\n' "$target_images" | sed '/^$/d' | wc -l)" -ne 1 ]; then
  echo "Unable to resolve one t3-code image from ${overlay}" >&2
  exit 1
fi
target_image=$target_images
current_image=$(
  kubectl --context "$context" --namespace t3-code get deployment t3-code \
    --output=jsonpath='{.spec.template.spec.containers[?(@.name=="t3-code")].image}'
)

if [ "$current_image" = "$target_image" ]; then
  echo "t3-code already uses ${target_image}"
  exit 0
fi

deadline=$((SECONDS + idle_timeout_seconds))
while true; do
  pod=$(
    kubectl --context "$context" --namespace t3-code get pods \
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
  if [ -z "$pod" ]; then
    echo "No ready t3-code pod is available for the idle check" >&2
    exit 1
  fi

  set +e
  kubectl --context "$context" --namespace t3-code exec --stdin "$pod" \
    --container t3-code -- node --input-type=module - \
    <"${script_dir}/check-t3-idle.mjs"
  idle_status=$?
  set -e

  case "$idle_status" in
    0)
      break
      ;;
    20)
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "Timed out waiting for t3-code work to become idle" >&2
        exit 1
      fi
      echo "Active T3 work remains; checking again in ${idle_poll_seconds}s"
      sleep "$idle_poll_seconds"
      ;;
    *)
      echo "The T3 idle check failed; the deployment was not changed" >&2
      exit "$idle_status"
      ;;
  esac
done

"${script_dir}/apply-kustomize-overlay.sh" "$overlay" "$context" cloud apply
kubectl --context "$context" --namespace t3-code rollout status \
  deployment/t3-code --timeout=10m

deployed_image=$(
  kubectl --context "$context" --namespace t3-code get deployment t3-code \
    --output=jsonpath='{.spec.template.spec.containers[?(@.name=="t3-code")].image}'
)
if [ "$deployed_image" != "$target_image" ]; then
  echo "Expected ${target_image}, found ${deployed_image}" >&2
  exit 1
fi

deployed_version=$(
  kubectl --context "$context" --namespace t3-code exec deployment/t3-code \
    --container t3-code -- t3 --version
)
echo "deployed ${deployed_image} (${deployed_version})"
