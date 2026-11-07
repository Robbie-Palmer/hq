#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" 'bash -se' <<'REMOTE'
set -euo pipefail
test "$(hostname)" = vector-development

image=nvcr.io/nvidia/cloud-native/dcgm@sha256:48464e50aa76671f5b204264cb4999739591112bf74330a727523f5655c6d7f2
docker run --rm \
  --cap-drop ALL \
  --cap-add SYS_ADMIN \
  --gpus all \
  --network none \
  --read-only \
  --security-opt no-new-privileges \
  --shm-size 1g \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --tmpfs /var/log/nvidia-dcgm:rw,nosuid,nodev,noexec,size=64m \
  --tmpfs /var/run:rw,nosuid,nodev,noexec,size=64m \
  --env NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  --entrypoint /bin/bash \
  "${image}" \
  -ceu '
    nv-hostengine -n &
    hostengine_pid=$!
    trap '\''kill "${hostengine_pid}" 2>/dev/null || true'\'' EXIT
    for _ in $(seq 1 30); do
      dcgmi discovery -l >/dev/null 2>&1 && break
      sleep 1
    done
    dcgmi discovery -l
    dcgmi diag --run 1
  '
REMOTE
