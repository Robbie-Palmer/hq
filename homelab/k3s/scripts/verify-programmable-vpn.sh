#!/usr/bin/env bash
set -euo pipefail

export KUBECONFIG="${HOME_KUBECONFIG:-$HOME/.kube/config}"
CONTEXT="${HOME_KUBE_CONTEXT:-colima-homelab-k3s}"
NAMESPACE="${MEDIA_NAMESPACE:-media}"
DISRUPTIVE=false
TAILNET_PEER="${TAILNET_TEST_PEER:-pi@raspberrypi.tailaa0e46.ts.net}"

usage() {
  cat <<'EOF'
Usage: verify-programmable-vpn.sh [--disruptive] [--tailnet-peer HOST]

The default run is read-only. --disruptive drops Gluetun's tunnel interface,
proves qBittorrent cannot reach the internet, and waits for Gluetun to recover.
EOF
}

while (($#)); do
  case "$1" in
    --disruptive) DISRUPTIVE=true ;;
    --tailnet-peer)
      shift
      TAILNET_PEER=${1:?--tailnet-peer requires a host}
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

KUBECTL=(kubectl --context "$CONTEXT" --namespace "$NAMESPACE")
pod=""
ready_deadline=$((SECONDS + 180))
while ((SECONDS < ready_deadline)); do
  candidate="$("${KUBECTL[@]}" get pod \
    --selector app.kubernetes.io/name=qbittorrent \
    --field-selector status.phase=Running \
    --output jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$candidate" ]] \
    && [[ "$("${KUBECTL[@]}" get pod "$candidate" \
      --output jsonpath='{.status.conditions[?(@.type=="Ready")].status}' \
      2>/dev/null || true)" == "True" ]] \
    && "${KUBECTL[@]}" exec "$candidate" -c gluetun -- \
      /gluetun-entrypoint healthcheck >/dev/null 2>&1; then
    pod="$candidate"
    break
  fi
  sleep 2
done
[[ -n "$pod" ]] || { echo "qBittorrent had no ready, healthy pod within 180 seconds" >&2; exit 1; }

echo "qBittorrent pod: $pod"
echo "Gluetun health: ready"

pod_ip="$("${KUBECTL[@]}" exec "$pod" -c gluetun -- \
  wget -qO- --timeout=10 https://ip.me | tr -d '\r\n')"
host_ip="$(curl -fsS --max-time 10 https://ip.me | tr -d '\r\n')"
[[ -n "$pod_ip" && -n "$host_ip" ]] || { echo "could not resolve egress addresses" >&2; exit 1; }
if [[ "$pod_ip" == "$host_ip" ]]; then
  echo "qBittorrent and the host use the same public address; isolated Proton egress is not proven" >&2
  exit 1
fi
echo "Egress: qBittorrent differs from the host"

resolver="$("${KUBECTL[@]}" get configmap programmable-vpn-settings \
  --output jsonpath='{.data.DNS_UPSTREAM_RESOLVERS}')"
[[ "$resolver" == "quad9" ]] || { echo "unexpected DNS resolver: $resolver" >&2; exit 1; }
gluetun_logs="$("${KUBECTL[@]}" logs "$pod" -c gluetun)"
grep -Eqi 'DNS|quad9' <<<"$gluetun_logs"
echo "DNS: Quad9 is configured inside Gluetun"

country="$("${KUBECTL[@]}" get configmap programmable-vpn-settings \
  --output jsonpath='{.data.VPN_EXIT_COUNTRY}')"
endpoint_ip="$("${KUBECTL[@]}" get configmap programmable-vpn-settings \
  --output jsonpath='{.data.WIREGUARD_ENDPOINT_IP}')"
grep -Fqi "Connecting to ${endpoint_ip}:" <<<"$gluetun_logs"
echo "Exit selection: Gluetun connected to the Proton-generated $country endpoint"

forwarded_port=""
for _ in $(seq 1 45); do
  forwarded_port="$("${KUBECTL[@]}" exec "$pod" -c gluetun -- \
    /bin/sh -c 'cat /gluetun/forwarded_port 2>/dev/null || true' \
    | tr -d '\r\n')"
  [[ "$forwarded_port" =~ ^[0-9]+$ ]] && break
  sleep 2
done
[[ "$forwarded_port" =~ ^[0-9]+$ ]] || { echo "Proton did not assign a forwarded port" >&2; exit 1; }
preferences="$("${KUBECTL[@]}" exec "$pod" -c gluetun -- \
  wget -qO- http://127.0.0.1:8080/api/v2/app/preferences)"
jq -e --argjson port "$forwarded_port" \
  '.listen_port == $port and .upnp == false and .current_network_interface == "tun0"' \
  >/dev/null <<<"$preferences"
"${KUBECTL[@]}" exec "$pod" -c qbittorrent -- /bin/sh -c \
  "netstat -lntu | grep -Eq '[:.]${forwarded_port}[[:space:]]'"
echo "Port forwarding: Proton's assigned port is active in qBittorrent"

tailnet_ip="$(tailscale ip -4 | sed -n '1p')"
[[ -n "$tailnet_ip" ]] || { echo "Mac mini has no Tailscale IPv4 address" >&2; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$TAILNET_PEER" /bin/sh <<EOF
set -eu
test "\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://${tailnet_ip}:8096/health)" = 200
for endpoint in \
  http://${tailnet_ip}:9696/ping \
  http://${tailnet_ip}:8989/ping \
  http://${tailnet_ip}:7878/ping; do
  test "\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "\$endpoint")" = 200
done
code="\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  http://${tailnet_ip}:8080/api/v2/app/version)"
case "\$code" in 200|401|403) ;; *) exit 1 ;; esac
EOF
echo "Tailnet: Jellyfin and media management surfaces are reachable from $TAILNET_PEER"

if [[ "$DISRUPTIVE" == true ]]; then
  "${KUBECTL[@]}" exec "$pod" -c gluetun -- ip link set tun0 down
  if "${KUBECTL[@]}" exec "$pod" -c qbittorrent -- \
      curl -fsS --max-time 5 https://ip.me >/dev/null 2>&1; then
    echo "qBittorrent retained internet access after the tunnel was dropped" >&2
    exit 1
  fi
  echo "Fail-closed: qBittorrent had no internet route after tunnel loss"

  recovered=false
  recovery_deadline=$((SECONDS + 180))
  while ((SECONDS < recovery_deadline)); do
    recovery_pod="$("${KUBECTL[@]}" get pod \
      --selector app.kubernetes.io/name=qbittorrent \
      --field-selector status.phase=Running \
      --output jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "$recovery_pod" ]] \
      && "${KUBECTL[@]}" exec "$recovery_pod" -c gluetun -- \
        /gluetun-entrypoint healthcheck >/dev/null 2>&1 \
      && "${KUBECTL[@]}" exec "$recovery_pod" -c qbittorrent -- \
        curl -fsS --max-time 5 https://ip.me >/dev/null 2>&1; then
      recovered=true
      break
    fi
    sleep 2
  done
  [[ "$recovered" == true ]] || { echo "Gluetun did not recover within 180 seconds" >&2; exit 1; }
  echo "Recovery: tunnel and qBittorrent egress returned without login"
fi

echo "Programmable VPN verification passed"
