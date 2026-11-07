#!/usr/bin/env bash

set -euo pipefail

readonly codechecker_version=6.29.3

project_root=$PWD
repository_root=$(git rev-parse --show-toplevel)
clang_root=$(mise where conda:clangxx)
clang_tools_root=$(mise where conda:clang-tools)
gcc_root=$(mise where conda:gxx)
python_root=$(mise where python)
toolchain_root="$project_root/build/codechecker-toolchain"
compile_commands="$project_root/build/codechecker-compile-commands.json"
clang_resource_dir=$($clang_root/bin/clang -print-resource-dir)

export CC="$gcc_root/bin/cc"

cmake -E rm -rf "$toolchain_root" build/codechecker build/codechecker.sarif \
  "$compile_commands"
cmake -E make_directory "$toolchain_root"
cmake -E create_symlink "$clang_root/bin/clang" "$toolchain_root/clang"
cmake -E create_symlink "$clang_tools_root/bin/clang-extdef-mapping" \
  "$toolchain_root/clang-extdef-mapping"
export PATH="$toolchain_root:$clang_root/bin:$clang_tools_root/bin:$PATH"
export CC_ANALYZER_BIN="clangsa:$toolchain_root/clang"

jq \
  --arg project_root "$project_root/" \
  --arg resource_include " -idirafter $clang_resource_dir/include" \
  '[
    .[]
    | select(.file | startswith($project_root))
    | select(.file | test("/(src/satellite_swarm|simulation/src|browser/src|examples/[^/]+)/[^/]+\\.cpp$"))
    | .command |= sub(" -o "; ($resource_include + " -o "))
  ]' \
  build/dev/compile_commands.json > "$compile_commands"
jq --exit-status 'length > 0' "$compile_commands" >/dev/null

run_codechecker() {
  uvx --python "$python_root/bin/python3" --from "codechecker==$codechecker_version" \
    CodeChecker "$@"
}

run_codechecker analyze \
  --analyzers clangsa \
  --ctu \
  --ctu-ast-mode load-from-pch \
  --ctu-reanalyze-on-failure \
  --jobs 2 \
  --output build/codechecker \
  "$compile_commands"

set +e
run_codechecker parse \
  build/codechecker \
  --export sarif \
  --output build/codechecker.sarif \
  --trim-path-prefix "$repository_root/"
parse_status=$?
set -e

case "$parse_status" in
  0)
    ;;
  2)
    echo "CodeChecker CTU reported findings in build/codechecker.sarif"
    ;;
  *)
    exit "$parse_status"
    ;;
esac
