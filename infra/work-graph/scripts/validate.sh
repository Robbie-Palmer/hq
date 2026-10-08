#!/usr/bin/env bash
set -euo pipefail

validation_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/work-graph-terraform-validate.XXXXXX")"
cleanup() {
  find "$validation_data_dir" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM

TF_DATA_DIR="$validation_data_dir" terraform init -backend=false > /dev/null
TF_DATA_DIR="$validation_data_dir" terraform validate
bash scripts/check-security-boundary.sh
