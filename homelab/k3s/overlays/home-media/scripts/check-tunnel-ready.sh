#!/bin/sh
set -eu

ip link show tun0 >/dev/null
wget -qO- --timeout=5 https://ip.me >/dev/null
