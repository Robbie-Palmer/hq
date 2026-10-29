#!/usr/bin/env bash
set -euo pipefail

validate_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/minimal-bootstrap-terraform-validate.XXXXXX")"
trap 'rm -rf "$validate_data_dir"' EXIT
export TF_DATA_DIR="$validate_data_dir"

terraform -chdir=examples/minimal-bootstrap/application init -backend=false -input=false > /dev/null
terraform -chdir=examples/minimal-bootstrap/application validate
