#!/usr/bin/env bash
set -u

# Holds the K3s media acquisitions deployments at the replica count the hub's
# VPN tunnel allows (ADR 020): deployments scale to 1 while the default route
# resolves through a tunnel interface (utun*) and to 0 while it does not, so
# the startup wrapper prevents a boot race and a later outage stops acquisition
# within one gate cycle. Jellyfin stays out of the acquisition path but scales
# with the stack so the household sees one coherent media service state.
# Recyclarr stays running: it only talks to Sonarr and Radarr.
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

VPN_IFACE="$(route -n get 1.1.1.1 2>/dev/null | awk '/^ *interface:/{print $2}')"
case "$VPN_IFACE" in
  utun*) desired=1 ;;
  *) desired=0 ;;
esac

for app in $APPS; do
  current="$("$KUBECTL_BIN" --context "$CONTEXT" --namespace "$NAMESPACE" \
    get deployment "$app" --output jsonpath='{.spec.replicas}' 2>/dev/null)" || current=""
  if [[ "$current" != "$desired" ]]; then
    if "$KUBECTL_BIN" --context "$CONTEXT" --namespace "$NAMESPACE" \
        scale deployment "$app" --replicas "$desired" >/dev/null 2>&1; then
      echo "$(date "$LOG_TS") $app scaled to $desired (tunnel: ${VPN_IFACE:-none})"
    else
      echo "$(date "$LOG_TS") failed to scale $app to $desired" >&2
    fi
  fi
done
