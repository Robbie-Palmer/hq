#!/usr/bin/env bash

host_ssh_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "${host_ssh_script_dir}/host-ssh.sh"
unset host_ssh_script_dir

vector_development_prepare_ssh() {
  local target=${1:?vector-development SSH target is required}

  VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE=${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE:-${HOME}/.ssh/personal-site-vector-development-known_hosts}
  host_lifecycle_prepare_ssh \
    "${target}" \
    "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}" \
    "${VECTOR_DEVELOPMENT_HOST_KEY_SHA256:-}"
  VECTOR_DEVELOPMENT_SSH_OPTIONS=(
    "${HOST_LIFECYCLE_SSH_OPTIONS[@]}"
  )
}
