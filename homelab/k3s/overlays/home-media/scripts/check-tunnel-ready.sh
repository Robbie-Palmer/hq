#!/bin/sh
set -eu

ip link show tun0 >/dev/null
/gluetun-entrypoint healthcheck
