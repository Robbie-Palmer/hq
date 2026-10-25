#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" 'test "$(hostname)" = vector-development'

if [[ ${VECTOR_DEVELOPMENT_SHUTDOWN:-} != vector-development ]]; then
  read -r -p 'Type vector-development to power off the laptop: ' confirmation
  if [[ ${confirmation} != vector-development ]]; then
    echo "shutdown cancelled" >&2
    exit 1
  fi
fi

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" \
  'test "$(hostname)" = vector-development && systemctl poweroff'
echo "Vector shutdown requested"
