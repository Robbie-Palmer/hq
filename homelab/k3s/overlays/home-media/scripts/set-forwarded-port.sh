#!/bin/sh
set -eu

port=${1:?missing forwarded port}
vpn_interface=${2:?missing VPN interface}

preferences=$(printf \
  '{"listen_port":%s,"current_network_interface":"%s","random_port":false,"upnp":false}' \
  "$port" \
  "$vpn_interface")

attempt=1
while [ "$attempt" -le 30 ]; do
  if wget \
    -qO- \
    --timeout=5 \
    --post-data "json=${preferences}" \
    http://127.0.0.1:8080/api/v2/app/setPreferences; then
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

echo "qBittorrent did not accept the forwarded port within 60 seconds" >&2
exit 1
