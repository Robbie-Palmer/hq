#!/usr/bin/env bash
set -euo pipefail

validate_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/project-modules-terraform-validate.XXXXXX")"
trap 'rm -rf "$validate_data_dir"' EXIT
export TF_DATA_DIR="$validate_data_dir"

terraform -chdir=v1 init -backend=false -input=false > /dev/null
terraform -chdir=v1 validate
