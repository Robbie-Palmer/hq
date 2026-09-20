#!/usr/bin/env bash

set -euo pipefail

host_system=$(uname -s)

case "$host_system" in
  Darwin)
    if ! command -v xcrun >/dev/null 2>&1; then
      echo 'xcrun is required. Install the Xcode Command Line Tools with xcode-select --install.' >&2
      exit 1
    fi
    compiler_sdk=$(xcrun --show-sdk-path)
    find src simulation/src browser/src examples -type f -name '*.cpp' -print0 |
      xargs -0 clang-tidy -p build/dev \
        --extra-arg-before="--sysroot=$compiler_sdk"
    ;;
  Linux)
    compiler_command=${CXX:-c++}
    if ! compiler=$(command -v "$compiler_command"); then
      echo 'A C++ compiler is required.' >&2
      exit 1
    fi
    gcc_install_dir=$(dirname "$("$compiler" -print-libgcc-file-name)")
    compiler_sysroot=$("$compiler" -print-sysroot)
    if [[ -n "$compiler_sysroot" ]]; then
      find src simulation/src browser/src examples -type f -name '*.cpp' -print0 |
        xargs -0 clang-tidy -p build/dev \
          --extra-arg-before="--gcc-install-dir=$gcc_install_dir" \
          --extra-arg-before="--sysroot=$compiler_sysroot"
    else
      find src simulation/src browser/src examples -type f -name '*.cpp' -print0 |
        xargs -0 clang-tidy -p build/dev \
          --extra-arg-before="--gcc-install-dir=$gcc_install_dir"
    fi
    ;;
  *)
    printf 'Unsupported developer platform: %s. Supported platforms are Linux and macOS.\n' \
      "$host_system" >&2
    exit 1
    ;;
esac
