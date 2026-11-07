#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "${script_dir}/../scripts/host-ssh.sh"

test_dir=$(mktemp -d)
trap 'rm -rf "${test_dir}"' EXIT

trusted_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKxWk5kYSL6V6jYwB6XRmOLb3NmDdxwjcA6B3QyVAQ6M"
other_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM10tppAS+3nlXzecNqk+YUuzwN2KtT5//gwoUqhDt36"
trusted_fingerprint=$(printf '%s lifecycle-test\n' "${trusted_key}" | ssh-keygen -lf - -E sha256 | awk '{ print $2 }')

mkdir -p "${test_dir}/bin"
cat >"${test_dir}/bin/ssh-keyscan" <<EOF
#!/usr/bin/env bash
host=\${!#}
printf '%s %s\n' "\${host}" '${trusted_key}'
EOF
chmod +x "${test_dir}/bin/ssh-keyscan"
export PATH="${test_dir}/bin:${PATH}"

known_hosts=${test_dir}/known_hosts
if host_lifecycle_prepare_ssh root@first.example "${known_hosts}"; then
  echo "an unverified first host key was accepted" >&2
  exit 1
fi

host_lifecycle_prepare_ssh root@first.example "${known_hosts}" "${trusted_fingerprint}"
grep -Fq "first.example ${trusted_key}" "${known_hosts}"
printf '%s\n' "${HOST_LIFECYCLE_SSH_OPTIONS[@]}" | grep -Fxq 'StrictHostKeyChecking=yes'

host_lifecycle_prepare_ssh root@alias.example "${known_hosts}"
grep -Fq "alias.example ${trusted_key}" "${known_hosts}"

if host_lifecycle_prepare_ssh root@first.example "${known_hosts}" "SHA256:not-the-key"; then
  echo "a stored host key passed with the wrong expected fingerprint" >&2
  exit 1
fi

cat >"${test_dir}/bin/ssh-keyscan" <<EOF
#!/usr/bin/env bash
host=\${!#}
printf '%s %s\n' "\${host}" '${other_key}'
EOF
chmod +x "${test_dir}/bin/ssh-keyscan"
if host_lifecycle_prepare_ssh root@changed.example "${known_hosts}"; then
  echo "a changed host key was trusted through an existing alias" >&2
  exit 1
fi

if host_lifecycle_prepare_ssh operator@first.example "${known_hosts}" "${trusted_fingerprint}"; then
  echo "an unsupported SSH user was accepted" >&2
  exit 1
fi

echo "host SSH verification tests passed"
