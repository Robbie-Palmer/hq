#!/usr/bin/env bash
set -euo pipefail

export KUBECONFIG="${HOME_KUBECONFIG:-$HOME/.kube/config}"
CONTEXT="${HOME_KUBE_CONTEXT:-colima-homelab-k3s}"
NAMESPACE="${MEDIA_NAMESPACE:-media}"
PROVIDER="${VPN_BENCHMARK_PROVIDER:-proton}"
DURATION_SECONDS="${VPN_BENCHMARK_DURATION_SECONDS:-1800}"
INTERVAL_SECONDS="${VPN_BENCHMARK_INTERVAL_SECONDS:-10}"
OUTPUT="${VPN_BENCHMARK_OUTPUT:-$PWD/vpn-benchmark-${PROVIDER}-$(date +%Y%m%dT%H%M%S).csv}"

if [[ ! "$DURATION_SECONDS" =~ ^[0-9]+$ || ! "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "duration and interval must be whole seconds" >&2
  exit 2
fi
if ((DURATION_SECONDS < INTERVAL_SECONDS || INTERVAL_SECONDS < 1)); then
  echo "duration must be at least one positive interval" >&2
  exit 2
fi

KUBECTL=(kubectl --context "$CONTEXT" --namespace "$NAMESPACE")
pod="$("${KUBECTL[@]}" get pod \
  --selector app.kubernetes.io/name=qbittorrent \
  --field-selector status.phase=Running \
  --output jsonpath='{.items[0].metadata.name}')"
node="$("${KUBECTL[@]}" get pod "$pod" --output jsonpath='{.spec.nodeName}')"
[[ -n "$pod" && -n "$node" ]] || { echo "qBittorrent pod is not running" >&2; exit 1; }

printf '%s\n' 'timestamp,provider,qbittorrent_download_bytes_per_second,pod_cpu_nanocores,pod_memory_working_set_bytes,colima_cpu_percent,colima_rss_kib,hotspot_cpu_percent,hotspot_rss_kib' >"$OUTPUT"
end=$((SECONDS + DURATION_SECONDS))
while ((SECONDS < end)); do
  timestamp="$(date -u +%FT%TZ)"
  transfer="$("${KUBECTL[@]}" exec "$pod" -c gluetun -- \
    wget -qO- http://127.0.0.1:8080/api/v2/transfer/info 2>/dev/null || echo '{}')"
  download_speed="$(jq -r '.dl_info_speed // 0' <<<"$transfer")"
  stats="$(kubectl --context "$CONTEXT" get --raw "/api/v1/nodes/${node}/proxy/stats/summary")"
  pod_stats="$(jq -c --arg namespace "$NAMESPACE" --arg pod "$pod" \
    '.pods[] | select(.podRef.namespace == $namespace and .podRef.name == $pod)' <<<"$stats")"
  pod_cpu="$(jq -r '.cpu.usageNanoCores // 0' <<<"$pod_stats")"
  pod_memory="$(jq -r '.memory.workingSetBytes // 0' <<<"$pod_stats")"

  colima="$(ps -axo pcpu=,rss=,command= | awk '/[c]olima-homelab-k3s/{cpu += $1; rss += $2} END {printf "%.1f,%d", cpu, rss}')"
  hotspot="$(ps -axo pcpu=,rss=,command= | awk '/[H]otspot Shield/{cpu += $1; rss += $2} END {printf "%.1f,%d", cpu, rss}')"
  printf '%s,%s,%s,%s,%s,%s,%s\n' \
    "$timestamp" "$PROVIDER" "$download_speed" "$pod_cpu" "$pod_memory" \
    "$colima" "$hotspot" >>"$OUTPUT"
  sleep "$INTERVAL_SECONDS"
done

echo "Benchmark samples written to $OUTPUT"
