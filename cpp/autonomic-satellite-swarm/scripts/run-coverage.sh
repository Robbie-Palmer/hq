#!/usr/bin/env bash

set -euo pipefail

host_system=$(uname -s)

case "$host_system" in
  Darwin)
    if ! command -v xcrun >/dev/null 2>&1; then
      echo 'xcrun is required. Install the Xcode Command Line Tools with xcode-select --install.' >&2
      exit 1
    fi
    coverage_cc=$(xcrun --find clang)
    coverage_cxx=$(xcrun --find clang++)
    coverage_reader=$(xcrun --find llvm-cov)
    gcov_executable="$coverage_reader gcov"
    ;;
  Linux)
    compiler_root=$(mise where conda:gxx)
    coverage_cc="$compiler_root/bin/gcc"
    coverage_cxx="$compiler_root/bin/g++"
    coverage_reader="$compiler_root/bin/gcov"
    gcov_executable="$coverage_reader"
    cmake_archiver="$compiler_root/bin/x86_64-conda-linux-gnu-ar"
    export PATH="$compiler_root/bin:$PATH"
    ;;
  *)
    printf 'Unsupported developer platform: %s. Supported platforms are Linux and macOS.\n' \
      "$host_system" >&2
    exit 1
    ;;
esac

for required_executable in "$coverage_cc" "$coverage_cxx" "$coverage_reader"; do
  if [[ ! -x "$required_executable" ]]; then
    printf 'Required coverage executable not found: %s\n' "$required_executable" >&2
    exit 1
  fi
done

export CC="$coverage_cc"
export CXX="$coverage_cxx"

cmake -E rm -rf build/coverage coverage
if [[ -n "${cmake_archiver:-}" ]]; then
  cmake --preset coverage "-DCMAKE_AR=$cmake_archiver"
else
  cmake --preset coverage
fi
cmake --build --preset coverage
ctest --preset coverage
cmake -E make_directory coverage
gcovr \
  --gcov-executable "$gcov_executable" \
  --root ../.. \
  --filter 'src/satellite_swarm/' \
  --filter 'simulation/' \
  --filter 'browser/src/' \
  --filter 'examples/simulation/' \
  --sonarqube coverage/sonarqube.xml \
  --print-summary \
  --fail-under-line 80 \
  --fail-under-branch 70 \
  build/coverage
