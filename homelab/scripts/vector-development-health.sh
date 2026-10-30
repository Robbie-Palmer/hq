#!/usr/bin/env bash
set -euo pipefail

target=${VECTOR_DEVELOPMENT_TAILNET_TARGET:-root@vector-development.tailaa0e46.ts.net}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

source "${script_dir}/vector-development-ssh.sh"
vector_development_prepare_ssh "${target}"

ssh "${VECTOR_DEVELOPMENT_SSH_OPTIONS[@]}" "${target}" 'bash -se' <<'REMOTE'
set -euo pipefail
test "$(hostname)" = vector-development
test "$(id -u robbie)" = 1000
test "$(id -u t3code)" = 2000
findmnt --noheadings --output OPTIONS / | tr ',' '\n' | grep -Fx prjquota >/dev/null
findmnt --noheadings --output SOURCE / | grep -Fx /dev/mapper/vector-development-root >/dev/null
test "$(cryptsetup luksUUID /dev/disk/by-partlabel/disk-root-root)" = 526bbc1a-bafd-45df-92c7-c668dd3ffde4
test "$(cryptsetup luksDump --dump-json-metadata /dev/disk/by-partlabel/disk-root-root | jq '.keyslots | length')" -ge 2
test -s /etc/secrets/initrd/vector-development_ssh_host_ed25519_key
test "$(stat -c %a /etc/secrets/initrd/vector-development_ssh_host_ed25519_key)" = 600
ethtool enp58s0 | grep -Eq '^[[:space:]]*Supports Wake-on:.*g'
ethtool enp58s0 | grep -Eq '^[[:space:]]*Wake-on: g$'
awk '$1 == "/dev/zram0" { found = 1 } END { if (!found) exit 1 }' /proc/swaps
systemctl is-active --quiet display-manager.service
systemctl is-active --quiet NetworkManager.service
systemctl is-active --quiet tailscaled.service
systemctl is-active --quiet k3s.service
systemctl is-active --quiet apparmor.service
systemctl is-active --quiet vector-development-power-profile.service
systemctl is-active --quiet vector-development-quiet-profile.service
systemctl is-active --quiet vector-development-thermal-monitor.service
grep -Fx 't3-code-agent-browser (unconfined)' /sys/kernel/security/apparmor/profiles >/dev/null
test "$(powerprofilesctl get)" = power-saver
test "$(cat /sys/devices/platform/msi-ec/fan_mode)" = silent
test "$(cat /sys/devices/platform/msi-ec/shift_mode)" = eco
test -s /var/lib/vector-development-thermal-monitor/status.json
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader \
  | grep -F 'NVIDIA GeForce RTX 4080 Laptop GPU' >/dev/null
test "$(cat /sys/module/nvidia_drm/parameters/modeset)" = Y
containerd_config=/var/lib/rancher/k3s/agent/etc/containerd/config.toml
nvidia_runtime=$(
  sed -n 's/^[[:space:]]*BinaryName = "\([^"]*\/nvidia-container-runtime\)"/\1/p' \
    "${containerd_config}" \
    | head -n 1
)
test -n "${nvidia_runtime}"
test -x "${nvidia_runtime}"
k3s kubectl get node vector-development --output=json \
  | jq -e '
      (.status.conditions | any(.type == "Ready" and .status == "True"))
      and .metadata.labels["homelab.dev/location"] == "home"
      and .metadata.labels["homelab.dev/capability"] == "agent-workspace"
      and .metadata.labels["homelab.dev/accelerator"] == "nvidia"
    ' >/dev/null
if k3s kubectl --namespace kube-system get daemonset nvidia-device-plugin-daemonset >/dev/null 2>&1; then
  k3s kubectl --namespace kube-system rollout status \
    daemonset/nvidia-device-plugin-daemonset --timeout=120s
  gpu_allocatable=
  for _ in $(seq 1 30); do
    gpu_allocatable=$(
      k3s kubectl get node vector-development \
        --output=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
    )
    [[ ${gpu_allocatable} == 1 ]] && break
    sleep 2
  done
  test "${gpu_allocatable}" = 1
fi
if k3s kubectl --namespace t3-code get deployment t3-code >/dev/null 2>&1; then
  k3s kubectl --namespace t3-code rollout status deployment/t3-code --timeout=180s
  pod=$(k3s kubectl --namespace t3-code get pod \
    --selector=app.kubernetes.io/name=t3-code \
    --field-selector=status.phase=Running \
    --output=jsonpath='{.items[0].metadata.name}')
  test -n "${pod}"
  k3s kubectl --namespace t3-code exec "${pod}" --container t3-code -- nvidia-smi -L \
    | grep -F 'NVIDIA GeForce RTX 4080 Laptop GPU' >/dev/null
  k3s kubectl --namespace t3-code exec "${pod}" --container t3-code -- \
    cat /proc/self/attr/current \
    | grep -Fx 't3-code-agent-browser (unconfined)' >/dev/null
  k3s kubectl --namespace t3-code exec "${pod}" --container t3-code -- sh -ec '
    browser_data=$(mktemp -d /tmp/chromium-health.XXXXXX)
    trap '\''rm -rf -- "$browser_data"'\'' EXIT
    timeout 30s chromium \
      --headless \
      --disable-dev-shm-usage \
      --disable-gpu \
      --no-first-run \
      --user-data-dir="$browser_data" \
      --dump-dom about:blank \
      | grep -F "<html"
  ' >/dev/null
  curl --fail --silent --show-error http://127.0.0.1:30773/ >/dev/null
fi
echo "desktop, encrypted remote boot, sandboxed browser, NVIDIA, Tailscale, and the independent K3s server are healthy"
REMOTE
