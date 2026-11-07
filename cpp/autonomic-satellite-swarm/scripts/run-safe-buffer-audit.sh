#!/usr/bin/env bash

set -euo pipefail

clang_root=$(mise where conda:clangxx)
clang_compiler="$clang_root/bin/clang++"
clang_archiver=$($clang_compiler -print-prog-name=ar)

if [[ "$clang_archiver" != /* ]]; then
  clang_archiver=$(command -v "$clang_archiver")
fi

source_revision=${SATELLITE_SWARM_SOURCE_REVISION:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}

cmake --preset safe-buffers \
  -DCMAKE_AR="$clang_archiver" \
  -DCMAKE_CXX_COMPILER="$clang_compiler" \
  -DSATELLITE_SWARM_SOURCE_REVISION="$source_revision"
cmake --build --preset safe-buffers
