#!/usr/bin/env bash
set -euo pipefail

terraform_command="${1:-terraform}"

import_if_missing() {
  local resource_address="$1"
  local import_id="$2"

  if "$terraform_command" state show -no-color "$resource_address" >/dev/null 2>&1; then
    echo "$resource_address is already imported."
    return
  fi

  "$terraform_command" import -input=false "$resource_address" "$import_id"
}

import_if_missing tailscale_acl.tailnet acl
import_if_missing tailscale_dns_configuration.tailnet dns_configuration
