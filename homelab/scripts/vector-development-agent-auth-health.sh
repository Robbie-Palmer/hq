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
    github_probe_dir=$(mktemp -d)
    trap "rm -rf -- \"${github_probe_dir}\"" EXIT
    git -C "${github_probe_dir}" init --quiet
    git -C "${github_probe_dir}" \
      -c user.name=t3-code-auth-health \
      -c user.email=t3-code-auth-health@invalid \
      -c commit.gpgsign=false \
      commit --quiet --allow-empty -m "Test GitHub write access"
    GIT_TERMINAL_PROMPT=0 git -C "${github_probe_dir}" push --dry-run \
      https://github.com/Robbie-Palmer/hq.git \
      HEAD:"refs/heads/t3-code-auth-health-check-$(date +%s)-$$" \
      >/dev/null 2>&1
    rm -rf -- "${github_probe_dir}"
    trap - EXIT
    case "$(command -v doppler)" in
      /opt/vector/bin/doppler|/data/home/.local/share/mise/shims/doppler) ;;
      *) exit 1 ;;
    esac
    probe="VECTOR_T3_AUTH_PROBE_$(date +%s)_$$"
    cleanup_doppler_probe() {
      for project in ai-review homelab personal-site work-graph; do
        doppler secrets delete "${probe}" \
          --project "${project}" --config dev --yes --silent \
          >/dev/null 2>&1 || true
      done
    }
    trap cleanup_doppler_probe EXIT
    for project in ai-review homelab personal-site work-graph; do
      case "${project}" in
        ai-review) test -n "${DOPPLER_TOKEN_AI_REVIEW:-}" ;;
        homelab) test -n "${DOPPLER_TOKEN_HOMELAB:-}" ;;
        personal-site) test -n "${DOPPLER_TOKEN_PERSONAL_SITE:-}" ;;
        work-graph) test -n "${DOPPLER_TOKEN_WORK_GRAPH:-}" ;;
      esac
      doppler secrets --project "${project}" --config dev --only-names \
        >/dev/null
      printf %s health-check \
        | doppler secrets set "${probe}" \
          --project "${project}" --config dev --no-interactive --silent \
          >/dev/null
      doppler secrets --project "${project}" --config dev --only-names --json \
        | jq -e --arg probe "${probe}" 'has($probe)' >/dev/null
      doppler secrets delete "${probe}" \
        --project "${project}" --config dev --yes --silent >/dev/null
    done
    trap - EXIT
  '

echo "Vector T3 GitHub and development-only Doppler access are healthy"
