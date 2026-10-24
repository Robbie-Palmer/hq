#!/usr/bin/env bash

vector_development_prepare_ssh() {
  local target=${1:?vector-development SSH target is required}

  if [[ ! ${target} =~ ^root@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "vector-development SSH target must be root@ followed by a hostname or IPv4 address" >&2
    return 1
  fi

  VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE=${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE:-${HOME}/.ssh/personal-site-vector-development-known_hosts}
  mkdir -p "$(dirname -- "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}")"
  touch "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}"
  chmod 600 "${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}"

  VECTOR_DEVELOPMENT_SSH_OPTIONS=(
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o "UserKnownHostsFile=${VECTOR_DEVELOPMENT_KNOWN_HOSTS_FILE}"
  )
}
