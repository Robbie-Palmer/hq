#!/usr/bin/env bash
set -euo pipefail

wrapper="examples/minimal-bootstrap/scripts/doppler-terraform-env.sh"
application="examples/minimal-bootstrap/application"
bash "$wrapper" apply terraform -chdir="$application" apply -input=false .cleanup-planfile
if bash "$wrapper" apply terraform -chdir="$application" state list \
  | grep -Fxq 'module.preview.terraform_data.profile_guard'; then
  bash "$wrapper" apply terraform -chdir="$application" state rm \
    'module.preview.terraform_data.profile_guard'
fi
