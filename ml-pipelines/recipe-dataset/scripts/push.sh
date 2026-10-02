#!/usr/bin/env bash
set -euo pipefail

exec bash ../scripts/doppler-pipeline-env ../scripts/dvc push
