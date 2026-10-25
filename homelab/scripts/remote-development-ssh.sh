#!/usr/bin/env bash

remote_development_prepare_ssh() {
  local target=${1:?remote development SSH target is required}

  if [[ ! ${target} =~ ^root@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "remote development SSH target must be root@ followed by a hostname or IPv4 address" >&2
    return 1
  fi

  REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE=${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE:-${HOME}/.ssh/personal-site-remote-development-known_hosts}
  mkdir -p "$(dirname -- "${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}")"
  touch "${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}"
  chmod 600 "${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}"

  REMOTE_DEVELOPMENT_SSH_OPTIONS=(
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o "UserKnownHostsFile=${REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE}"
  )
}
