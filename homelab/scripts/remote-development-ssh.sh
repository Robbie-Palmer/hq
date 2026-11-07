#!/usr/bin/env bash

host_ssh_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "${host_ssh_script_dir}/host-ssh.sh"
unset host_ssh_script_dir

remote_development_prepare_ssh() {
  local target=${1:?remote development SSH target is required}

  REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE=${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE:-${HOME}/.ssh/personal-site-remote-development-known_hosts}
  host_lifecycle_prepare_ssh \
    "${target}" \
    "${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}" \
    "${REMOTE_DEVELOPMENT_HOST_KEY_SHA256:-}"
  REMOTE_DEVELOPMENT_SSH_OPTIONS=(
    "${HOST_LIFECYCLE_SSH_OPTIONS[@]}"
  )
}
