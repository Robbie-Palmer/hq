#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: mise //ml-pipelines/annotation-workbench-service:serve:tailnet -- /absolute/path/to/bundle.json" >&2
  exit 2
fi

bundle_path="$1"
if [[ ! -f "$bundle_path" ]]; then
  echo "review bundle does not exist: $bundle_path" >&2
  exit 2
fi
if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale is required for private mobile QA" >&2
  exit 2
fi

tailnet_ip="$(tailscale ip -4 | sed -n '1p')"
if [[ -z "$tailnet_ip" ]]; then
  echo "this machine has no active Tailscale IPv4 address" >&2
  exit 2
fi

ui_port="${ANNOTATION_WORKBENCH_UI_PORT:-3000}"
if [[ ! "$ui_port" =~ ^[0-9]+$ ]] || ((ui_port < 1024 || ui_port > 65535)); then
  echo "ANNOTATION_WORKBENCH_UI_PORT must be between 1024 and 65535" >&2
  exit 2
fi
if nc -z -w 1 "$tailnet_ip" "$ui_port" >/dev/null 2>&1; then
  echo "tailnet UI port is already in use: ${tailnet_ip}:${ui_port}" >&2
  exit 2
fi

ui_origin="http://${tailnet_ip}:${ui_port}"
api_url="http://${tailnet_ip}:8765"
api_pid=""

cleanup() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mise //ml-pipelines/annotation-workbench-service:serve -- \
  --bundle="$bundle_path" \
  --host="$tailnet_ip" \
  --allowed-origins="$ui_origin" &
api_pid=$!

for _ in {1..40}; do
  if curl --fail --silent --output /dev/null "${api_url}/api/v1/health"; then
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "review API stopped before becoming ready" >&2
    exit 1
  fi
  sleep 0.25
done
if ! curl --fail --silent --output /dev/null "${api_url}/api/v1/health"; then
  echo "review API did not become ready at $api_url" >&2
  exit 1
fi

echo "Annotation Workbench mobile QA: ${ui_origin}/annotation-workbench"
echo "FastAPI docs: ${api_url}/api/docs"
mise //ui:dev -- --hostname "$tailnet_ip" --port "$ui_port"
