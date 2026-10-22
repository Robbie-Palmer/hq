#!/bin/sh
set -eu

port=${1:?missing forwarded port}
vpn_interface=${2:?missing VPN interface}

preferences=$(printf \
  '{"listen_port":%s,"current_network_interface":"%s","random_port":false,"upnp":false}' \
  "$port" \
  "$vpn_interface")

exec wget \
  -O- \
  -nv \
  --retry-connrefused \
  --post-data "json=${preferences}" \
  http://127.0.0.1:8080/api/v2/app/setPreferences
