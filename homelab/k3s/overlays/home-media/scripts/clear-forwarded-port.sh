#!/bin/sh
set -eu

exec wget \
  -O- \
  -nv \
  --retry-connrefused \
  --post-data 'json={"listen_port":0,"current_network_interface":"lo"}' \
  http://127.0.0.1:8080/api/v2/app/setPreferences
