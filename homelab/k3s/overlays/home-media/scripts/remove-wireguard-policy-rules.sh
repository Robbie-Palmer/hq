#!/bin/sh
set -eu

ip rule del table 51820 2>/dev/null || true
ip -6 rule del table 51820 2>/dev/null || true
