#!/usr/bin/env bash
set -euo pipefail

exec bash ../scripts/doppler-pipeline-env.sh ../scripts/dvc.sh push
