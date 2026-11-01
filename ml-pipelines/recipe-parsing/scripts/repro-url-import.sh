#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

dvc_site_cache="$project_dir/.dvc/tmp/site-cache"
DVC_SITE_CACHE_DIR="$dvc_site_cache" DVC_NO_ANALYTICS=1 \
  exec bash ../scripts/dvc.sh repro \
    validate_url_import_corpus \
    replay_url_import_corpus \
    evaluate_url_import_baseline
