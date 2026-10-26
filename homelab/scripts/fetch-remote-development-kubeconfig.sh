#!/usr/bin/env bash
set -euo pipefail

target=${REMOTE_DEVELOPMENT_TAILNET_TARGET:-root@remote-development}
api_server=${REMOTE_DEVELOPMENT_KUBE_API_SERVER:-https://${REMOTE_DEVELOPMENT_TAILNET_HOST:-remote-development}:6443}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
homelab_dir=$(cd -- "${script_dir}/.." && pwd)
kube_dir="${homelab_dir}/.kube"
kubeconfig="${kube_dir}/remote-development.yaml"
temporary=$(mktemp)

source "${script_dir}/remote-development-ssh.sh"
remote_development_prepare_ssh "${target}"

cleanup() {
  if [ -f "${temporary}" ]; then
    shred --remove "${temporary}" 2>/dev/null || rm -f "${temporary}"
  fi
}
trap cleanup EXIT

mkdir -p "${kube_dir}"
chmod 700 "${kube_dir}"
ssh "${REMOTE_DEVELOPMENT_SSH_OPTIONS[@]}" \
  "${target}" \
  'cat /etc/rancher/k3s/k3s.yaml' >"${temporary}"
chmod 600 "${temporary}"

KUBECONFIG="${temporary}" kubectl config set-cluster default \
  --server="${api_server}" >/dev/null
KUBECONFIG="${temporary}" kubectl config rename-context default remote-development >/dev/null

actual_server=$(KUBECONFIG="${temporary}" kubectl config view \
  --minify \
  --output=jsonpath='{.clusters[0].cluster.server}')
new_ca=$(KUBECONFIG="${temporary}" kubectl config view \
  --minify \
  --raw \
  --output=jsonpath='{.clusters[0].cluster.certificate-authority-data}')
client_certificate=$(KUBECONFIG="${temporary}" kubectl config view \
  --minify \
  --raw \
  --output=jsonpath='{.users[0].user.client-certificate-data}')
client_key=$(KUBECONFIG="${temporary}" kubectl config view \
  --minify \
  --raw \
  --output=jsonpath='{.users[0].user.client-key-data}')

if [ "${actual_server}" != "${api_server}" ] \
  || [ -z "${new_ca}" ] \
  || [ -z "${client_certificate}" ] \
  || [ -z "${client_key}" ]; then
  echo "downloaded kubeconfig failed endpoint or credential validation" >&2
  exit 1
fi

if [ -f "${kubeconfig}" ]; then
  previous_ca=$(KUBECONFIG="${kubeconfig}" kubectl config view \
    --minify \
    --raw \
    --output=jsonpath='{.clusters[0].cluster.certificate-authority-data}')
  if [ -n "${previous_ca}" ] \
    && [ "${previous_ca}" != "${new_ca}" ] \
    && [ "${REMOTE_DEVELOPMENT_ACCEPT_NEW_KUBE_CA:-0}" != 1 ]; then
    echo "remote-development Kubernetes CA changed; refusing to replace kubeconfig" >&2
    echo "verify the cluster rebuild, then retry with REMOTE_DEVELOPMENT_ACCEPT_NEW_KUBE_CA=1" >&2
    exit 1
  fi
fi

mv "${temporary}" "${kubeconfig}"
chmod 600 "${kubeconfig}"

echo "wrote ${kubeconfig}"
KUBECONFIG="${kubeconfig}" kubectl config current-context
