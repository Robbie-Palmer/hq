#!/usr/bin/env bash

host_lifecycle_prepare_ssh() {
  local target=${1:?SSH target is required}
  local known_hosts_file=${2:?known-hosts file is required}
  local expected_fingerprint=${3:-}
  local host scan actual_fingerprint trusted_fingerprints

  if [[ ! ${target} =~ ^root@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "host lifecycle SSH target must be root@ followed by a hostname or IPv4 address" >&2
    return 1
  fi
  host=${target#root@}

  mkdir -p "$(dirname -- "${known_hosts_file}")"
  touch "${known_hosts_file}"
  chmod 600 "${known_hosts_file}"

  if ssh-keygen -F "${host}" -f "${known_hosts_file}" >/dev/null; then
    if [[ -n ${expected_fingerprint} ]]; then
      actual_fingerprint=$(
        ssh-keygen -F "${host}" -f "${known_hosts_file}" \
          | ssh-keygen -lf - -E sha256 \
          | awk '{ print $2 }' \
          | sort -u
      )
      if [[ ${actual_fingerprint} != "${expected_fingerprint}" ]]; then
        echo "stored SSH host key for ${host} does not match the verified fingerprint" >&2
        return 1
      fi
    fi
  else
    scan=$(ssh-keyscan -T 10 -t ed25519 "${host}" 2>/dev/null) || {
      echo "could not scan the SSH host key for ${host}" >&2
      return 1
    }
    actual_fingerprint=$(
      printf '%s\n' "${scan}" \
        | ssh-keygen -lf - -E sha256 \
        | awk '{ print $2 }' \
        | sort -u
    )
    if [[ -z ${actual_fingerprint} || ${actual_fingerprint} == *$'\n'* ]]; then
      echo "SSH host-key scan for ${host} did not return one Ed25519 fingerprint" >&2
      return 1
    fi

    trusted_fingerprints=
    if [[ -s ${known_hosts_file} ]]; then
      trusted_fingerprints=$(
        ssh-keygen -lf "${known_hosts_file}" -E sha256 \
          | awk '{ print $2 }' \
          | sort -u
      )
    fi
    if [[ -n ${expected_fingerprint} ]]; then
      if [[ ${actual_fingerprint} != "${expected_fingerprint}" ]]; then
        echo "scanned SSH host key for ${host} does not match the verified fingerprint" >&2
        return 1
      fi
    elif ! grep -Fxq -- "${actual_fingerprint}" <<<"${trusted_fingerprints}"; then
      echo "no verified SSH host-key fingerprint is available for ${host}" >&2
      echo "verify it out of band, then set the host-specific *_HOST_KEY_SHA256 variable" >&2
      return 1
    fi

    printf '%s\n' "${scan}" >>"${known_hosts_file}"
  fi

  HOST_LIFECYCLE_SSH_OPTIONS=(
    -o BatchMode=yes
    -o StrictHostKeyChecking=yes
    -o "UserKnownHostsFile=${known_hosts_file}"
  )
}
