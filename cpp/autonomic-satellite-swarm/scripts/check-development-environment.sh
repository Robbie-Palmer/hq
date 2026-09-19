#!/usr/bin/env bash

set -euo pipefail

require_command() {
  local command_name=$1
  local install_hint=$2

  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s. %s\n' "$command_name" "$install_hint" >&2
    return 1
  fi
}

require_executable() {
  local executable_path=$1

  if [[ ! -x "$executable_path" ]]; then
    printf 'Missing required executable: %s\n' "$executable_path" >&2
    return 1
  fi
}

require_cpp20() {
  local compiler_path=$1

  if ! printf '%s\n' 'static_assert(__cplusplus >= 202002L);' | \
    "$compiler_path" -std=c++20 -x c++ -fsyntax-only - >/dev/null 2>&1; then
    printf 'Compiler does not support the required C++20 mode: %s\n' "$compiler_path" >&2
    return 1
  fi
}

mise_install_hint='Run mise install from the project directory.'

require_command git 'Install Git with your operating system package manager.'
require_command cmake "$mise_install_hint"
require_command ninja "$mise_install_hint"
require_command clang-format "$mise_install_hint"
require_command clang-tidy "$mise_install_hint"
require_command gcovr "$mise_install_hint"
require_command node 'Run mise install from the repository root.'
require_command arduino-cli "$mise_install_hint"

host_system=$(uname -s)
host_architecture=$(uname -m)

case "$host_system" in
  Darwin)
    require_command xcrun 'Install the Xcode Command Line Tools with xcode-select --install.'
    host_c_compiler=$(xcrun --find clang)
    host_compiler=$(xcrun --find clang++)
    host_sdk=$(xcrun --show-sdk-path)
    coverage_tool=$(xcrun --find llvm-cov)
    require_executable "$host_c_compiler"
    require_executable "$host_compiler"
    require_executable "$coverage_tool"
    require_cpp20 "$host_compiler"
    printf 'Developer environment ready for macOS (%s).\n' "$host_architecture"
    printf 'Host compiler: %s\n' "$host_compiler"
    printf 'Host SDK: %s\n' "$host_sdk"
    printf 'Coverage reader: %s gcov\n' "$coverage_tool"
    ;;
  Linux)
    require_command c++ 'Install a C++20 compiler with your operating system package manager.'
    host_compiler=$(command -v c++)
    compiler_root=$(mise where conda:gxx)
    coverage_c_compiler="$compiler_root/bin/gcc"
    coverage_compiler="$compiler_root/bin/g++"
    coverage_tool="$compiler_root/bin/gcov"
    require_executable "$coverage_c_compiler"
    require_executable "$coverage_compiler"
    require_executable "$coverage_tool"
    require_cpp20 "$host_compiler"
    require_cpp20 "$coverage_compiler"
    printf 'Developer environment ready for Linux (%s).\n' "$host_architecture"
    printf 'Host compiler: %s\n' "$host_compiler"
    printf 'Coverage compiler: %s\n' "$coverage_compiler"
    printf 'Coverage reader: %s\n' "$coverage_tool"
    ;;
  *)
    printf 'Unsupported developer platform: %s. Supported platforms are Linux and macOS.\n' \
      "$host_system" >&2
    exit 1
    ;;
esac
