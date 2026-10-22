#!/bin/sh
set -eu

config=/config/qBittorrent/qBittorrent.conf
mkdir -p "$(dirname "$config")"
touch "$config"

set_value() {
  key=$1
  value=$2
  if grep -Fq "${key}=" "$config"; then
    escaped_key=$(printf '%s' "$key" | sed 's/[][\/.^$*]/\\&/g')
    sed -i "s/^${escaped_key}=.*/${key}=${value}/" "$config"
  else
    printf '%s=%s\n' "$key" "$value" >>"$config"
  fi
}

# Gluetun updates qBittorrent through the loopback Web API whenever Proton
# assigns or removes a port. Only containers in this pod share loopback.
set_value 'WebUI\LocalHostAuth' false
set_value 'Connection\UPnP' false
