#!/usr/bin/env bash
set -euo pipefail

dvc_command=(
  bash ../scripts/doppler-pipeline-env
  uv tool run --from 'dvc[s3]==3.67.1' dvc
)

"${dvc_command[@]}" repro prepare_gector_model
"${dvc_command[@]}" push data/models/gector-2024

echo "GECToR-2024 is verified and stored in the writing-editor DVC remote."
echo "Commit the resulting dvc.lock change so clean checkouts can pull it."
