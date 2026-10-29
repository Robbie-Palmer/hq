#!/usr/bin/env bash
set -euo pipefail

wrapper="examples/minimal-bootstrap/scripts/doppler-terraform-env.sh"
application="examples/minimal-bootstrap/application"
bash "$wrapper" apply terraform -chdir="$application" apply -input=false .cleanup-planfile
state_addresses="$(bash "$wrapper" apply terraform -chdir="$application" state list)"
if grep -Fxq 'module.preview.terraform_data.profile_guard' <<<"$state_addresses"; then
  bash "$wrapper" apply terraform -chdir="$application" state rm \
    'module.preview.terraform_data.profile_guard'
fi
