#!/usr/bin/env bash
set -u

# Reconciles the home media deployments after the migration from the host VPN
# gate in ADR 017. qBittorrent now shares a network namespace with Gluetun, so
# its firewall blocks non-tunnel egress. Jellyfin and management services no
# longer disappear when the Mac's interactive VPN client is disconnected.
#
# K3s owns restarts, probes, and reconciliation; this script only reconciles
# the replica field, cycle by cycle, under launchd (10-second interval).

# launchd contexts lack mise's per-project tool config, so resolve the pinned
# kubectl binary directly from the mise installs directory.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG_TS="+%F %T"

KUBECTL_BIN="$(ls -t "$HOME"/.local/share/mise/installs/aqua-kubernetes-kubernetes-kubectl/*/kubectl 2>/dev/null | head -1)"
if [[ -z "$KUBECTL_BIN" ]] && command -v kubectl >/dev/null 2>&1; then
  KUBECTL_BIN="$(command -v kubectl)"
fi
if [[ -z "$KUBECTL_BIN" ]]; then
  echo "$(date "$LOG_TS") kubectl not found; cannot reconcile the media stack" >&2
  exit 1
fi
export KUBECONFIG="${HOME_KUBECONFIG:-$HOME/.kube/config}"

CONTEXT="${MEDIA_KUBE_CONTEXT:-colima-homelab-k3s}"
NAMESPACE="${MEDIA_NAMESPACE:-media}"
APPS="jellyfin prowlarr sonarr radarr qbittorrent"

desired=1

for app in $APPS; do
  current="$("$KUBECTL_BIN" --context "$CONTEXT" --namespace "$NAMESPACE" \
    get deployment "$app" --output jsonpath='{.spec.replicas}' 2>/dev/null)" || current=""
  if [[ "$current" != "$desired" ]]; then
    if "$KUBECTL_BIN" --context "$CONTEXT" --namespace "$NAMESPACE" \
        scale deployment "$app" --replicas "$desired" >/dev/null 2>&1; then
      echo "$(date "$LOG_TS") $app scaled to $desired"
    else
      echo "$(date "$LOG_TS") failed to scale $app to $desired" >&2
    fi
  fi
done
