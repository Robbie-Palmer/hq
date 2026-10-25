#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:?Usage: guarded-apply.sh <plan-file> <command> [args...]}"
shift

if [[ ! -f "$plan_file" ]]; then
  echo "Refusing tailnet apply: reviewed plan '$plan_file' does not exist." >&2
  exit 1
fi

if [[ "${TAILNET_APPLY_CONFIRM:-}" != "apply hq-tailnet" ]]; then
  echo "Refusing tailnet apply: set TAILNET_APPLY_CONFIRM='apply hq-tailnet' after reviewing the saved plan." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Refusing tailnet apply: no Terraform command was supplied." >&2
  exit 2
fi

exec "$@"
