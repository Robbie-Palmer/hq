set -euo pipefail

metrics_url=${VECTOR_GPU_METRICS_URL:-http://127.0.0.1:19400/api/v1/namespaces/gpu-telemetry/services/http:dcgm-exporter:9400/proxy/metrics}
statsd_sink=${VECTOR_GPU_STATSD_SINK:-/dev/udp/127.0.0.1/8125}

metric_max() {
  local metric=$1
  awk -v metric="${metric}" '
    index($0, metric "{") == 1 || $1 == metric {
      value = $NF + 0
      if (!found || value > maximum) maximum = value
      found = 1
    }
    END { print found ? maximum : 0 }
  '
}

plugin_up=0
if k3s kubectl --request-timeout=5s --namespace kube-system \
  get daemonset nvidia-device-plugin-daemonset --output=json 2>/dev/null \
  | jq -e '
      .status.numberAvailable == .status.desiredNumberScheduled and
      (.status.numberUnavailable // 0) == 0 and
      .status.desiredNumberScheduled > 0
    ' >/dev/null; then
  plugin_up=1
fi

gpu_allocatable=$(
  k3s kubectl --request-timeout=5s get node vector-development \
    --output=jsonpath='{.status.allocatable.nvidia\.com/gpu}' 2>/dev/null \
    || printf '0'
)
[[ ${gpu_allocatable} =~ ^[0-9]+$ ]] || gpu_allocatable=0

metrics_up=0
metrics=$(curl --fail --silent --show-error --max-time 5 "${metrics_url}" 2>/dev/null || true)
if grep -q '^DCGM_FI_DEV_GPU_UTIL{' <<<"${metrics}"; then
  metrics_up=1
fi

xid_code=$(metric_max DCGM_FI_DEV_XID_ERRORS <<<"${metrics}")
temperature=$(metric_max DCGM_FI_DEV_GPU_TEMP <<<"${metrics}")
fb_used=$(metric_max DCGM_FI_DEV_FB_USED <<<"${metrics}")
fb_free=$(metric_max DCGM_FI_DEV_FB_FREE <<<"${metrics}")
throttle_reasons=$(metric_max DCGM_FI_DEV_CLOCK_THROTTLE_REASONS <<<"${metrics}")
fb_used_percent=$(awk -v used="${fb_used}" -v free="${fb_free}" \
  'BEGIN { total = used + free; print (total > 0 ? used * 100 / total : 0) }')
thermal_throttle=$(awk -v reasons="${throttle_reasons}" \
  'BEGIN { print int(reasons / 32) % 4 != 0 ? 1 : 0 }')
power_brake=$(awk -v reasons="${throttle_reasons}" \
  'BEGIN { print int(reasons / 128) % 2 != 0 ? 1 : 0 }')
power_cap=$(awk -v reasons="${throttle_reasons}" \
  'BEGIN { print int(reasons / 4) % 2 != 0 ? 1 : 0 }')

printf '%s\n' \
  "vector_development.gpu.plugin_up:${plugin_up}|g" \
  "vector_development.gpu.metrics_up:${metrics_up}|g" \
  "vector_development.gpu.allocatable:${gpu_allocatable}|g" \
  "vector_development.gpu.xid_code:${xid_code}|g" \
  "vector_development.gpu.temperature_c:${temperature}|g" \
  "vector_development.gpu.fb_used_mib:${fb_used}|g" \
  "vector_development.gpu.fb_free_mib:${fb_free}|g" \
  "vector_development.gpu.fb_used_percent:${fb_used_percent}|g" \
  "vector_development.gpu.thermal_throttle:${thermal_throttle}|g" \
  "vector_development.gpu.power_brake:${power_brake}|g" \
  "vector_development.gpu.power_cap:${power_cap}|g" \
  >"${statsd_sink}"
