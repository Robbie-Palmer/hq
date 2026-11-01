#!/usr/bin/env bash
set -euo pipefail

test_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/project-modules-terraform-test.XXXXXX")"
trap 'rm -rf "$test_data_dir"' EXIT
export TF_DATA_DIR="$test_data_dir"

terraform -chdir=v1 init -backend=false -input=false > /dev/null
terraform -chdir=v1 test
bash scripts/test-stateless-validation.sh
