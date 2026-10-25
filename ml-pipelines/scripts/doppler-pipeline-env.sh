#!/usr/bin/env bash
set -euo pipefail

project="${DOPPLER_PROJECT:-personal-site}"
config="${DOPPLER_ML_PIPELINES_CONFIG:-dev_ml_pipelines}"

if [ "${DOPPLER_PIPELINE_ENV_WRAPPED:-}" != "1" ]; then
  if command -v doppler >/dev/null 2>&1; then
    export DOPPLER_PIPELINE_ENV_WRAPPED=1
    exec doppler run --project "$project" --config "$config" -- bash "$0" "$@"
  elif [ "${CI:-}" != "true" ]; then
    echo "Cannot run ML pipeline commands locally: doppler is required." >&2
    echo "Install and authenticate the Doppler CLI, then run this command again." >&2
    exit 1
  fi
fi

set_if_unset() {
  local name="$1"
  local value="${2:-}"

  if [ -z "${!name:-}" ] && [ -n "$value" ]; then
    export "$name=$value"
  fi
}

# DVC's S3 remote reads the AWS names; R2 credentials are stored under their
# own names so one set of secrets serves both local and CI, which maps them
# the same way.
set_if_unset AWS_ACCESS_KEY_ID "${R2_ACCESS_KEY_ID:-}"
set_if_unset AWS_SECRET_ACCESS_KEY "${R2_SECRET_ACCESS_KEY:-}"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "Missing R2 credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the Doppler config '${config}' (or export the AWS_* equivalents)." >&2
  exit 1
fi

exec "$@"
