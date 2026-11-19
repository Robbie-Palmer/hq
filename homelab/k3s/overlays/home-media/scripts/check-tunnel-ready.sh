#!/bin/sh
set -eu

ip link show tun0 >/dev/null
ip link set tun0 up
exec /gluetun-entrypoint healthcheck
