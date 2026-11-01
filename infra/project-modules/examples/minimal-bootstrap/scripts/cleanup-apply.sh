#!/usr/bin/env bash
set -euo pipefail

wrapper="examples/minimal-bootstrap/scripts/doppler-terraform-env.sh"
application="examples/minimal-bootstrap/application"
bash "$wrapper" apply terraform -chdir="$application" apply -input=false .cleanup-planfile
state_addresses="$(bash "$wrapper" apply terraform -chdir="$application" state list)"
if [[ -n "$state_addresses" ]]; then
  printf 'Application cleanup left managed state addresses:\n%s\n' "$state_addresses" >&2
  exit 1
fi
