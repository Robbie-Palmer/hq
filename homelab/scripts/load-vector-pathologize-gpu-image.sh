#!/usr/bin/env bash
set -euo pipefail

image=ghcr.io/robbie-palmer/pathologize-gpu-benchmark:0.1.0
target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

for command in docker gzip ssh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

docker image inspect "${image}" >/dev/null

digest=$(
  docker save "${image}" \
    | gzip --fast \
    | ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" '
        set -euo pipefail
        image=ghcr.io/robbie-palmer/pathologize-gpu-benchmark:0.1.0
        test "$(hostname)" = vector-development
        test "$(k3s kubectl get node vector-development --output=jsonpath='"'"'{.metadata.labels.homelab\.dev/location}'"'"')" = home
        gzip --decompress --stdout | k3s ctr images import - >/dev/null
        k3s ctr images list "name==${image}" \
          | awk "NR > 1 && \$1 == \"${image}\" { print \$3; exit }"
      '
)

if [[ ! ${digest} =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "K3s returned an invalid imported image digest" >&2
  exit 1
fi

reference=${image%:*}@${digest}
ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
  "k3s crictl inspecti '${reference}' >/dev/null"

echo "${reference}"
