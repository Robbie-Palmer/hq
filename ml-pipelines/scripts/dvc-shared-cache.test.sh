#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="$script_dir/dvc-shared-cache.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/dvc-shared-cache-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture="$test_root/repository"
feature_worktree="$test_root/feature"
cache_dir="$test_root/cache"
config_dir="$test_root/config"
site_cache_dir="$test_root/site-cache"
log_file="$test_root/dvc.log"

assert_contains() {
  local output="$1"
  local expected="$2"
  if [[ $output != *"$expected"* ]]; then
    echo "Expected output to contain: $expected" >&2
    exit 1
  fi
}

assert_not_contains() {
  local output="$1"
  local unexpected="$2"
  if [[ $output == *"$unexpected"* ]]; then
    echo "Expected output not to contain: $unexpected" >&2
    exit 1
  fi
}

assert_fails_with() {
  local expected="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
  assert_contains "$output" "$expected"
}

mkdir -p \
  "$fixture/ml-pipelines/scripts" \
  "$fixture/project-a/.dvc" \
  "$fixture/project-b/.dvc" \
  "$cache_dir" \
  "$config_dir/dvc" \
  "$site_cache_dir"
cp "$subject" "$fixture/ml-pipelines/scripts/dvc-shared-cache.sh"
printf '[core]\n    autostage = false\n' > "$fixture/project-a/.dvc/config"
printf '[core]\n    autostage = false\n' > "$fixture/project-b/.dvc/config"
printf '[cache]\n    dir = %s\n[core]\n    site_cache_dir = %s\n' \
  "$cache_dir" "$site_cache_dir" > "$config_dir/dvc/config"

cat > "$fixture/ml-pipelines/scripts/dvc.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$PWD" "$*" >> "$DVC_TEST_LOG"
if [[ ${1:-} == "cache" && ${2:-} == "dir" ]]; then
  printf '%s\n' "$DVC_TEST_CACHE_DIR"
  exit 0
fi
if [[ ${1:-} == "gc" ]]; then
  exit 0
fi
echo "Unexpected fake DVC command: $*" >&2
exit 1
EOF
chmod +x "$fixture/ml-pipelines/scripts/dvc.sh" "$fixture/ml-pipelines/scripts/dvc-shared-cache.sh"

git -C "$fixture" init --quiet --initial-branch=main
git -C "$fixture" config user.name "DVC cache test"
git -C "$fixture" config user.email "dvc-cache@example.invalid"
git -C "$fixture" add .
git -C "$fixture" commit --quiet -m "main fixture"
git -C "$fixture" update-ref refs/remotes/origin/main HEAD

git -C "$fixture" worktree add --quiet -b feature "$feature_worktree" main
mkdir -p "$feature_worktree/project-feature/.dvc"
printf '[core]\n    autostage = false\n' > "$feature_worktree/project-feature/.dvc/config"
git -C "$feature_worktree" add .
git -C "$feature_worktree" commit --quiet -m "feature-only project"

declare -a environment=(
  env
  "DVC_TEST_CACHE_DIR=$cache_dir"
  "DVC_TEST_LOG=$log_file"
  "XDG_CONFIG_HOME=$config_dir"
)

status_output="$(cd "$fixture" && "${environment[@]}" bash ml-pipelines/scripts/dvc-shared-cache.sh status --verbose)"
assert_contains "$status_output" "retained ref: origin/main"
assert_contains "$status_output" "retained DVC projects: 2"
assert_contains "$status_output" "ephemeral worktrees ignored: 2"
assert_contains "$status_output" "project-a"
assert_contains "$status_output" "project-b"
assert_not_contains "$status_output" "project-feature"

: > "$log_file"
(cd "$fixture" && "${environment[@]}" bash ml-pipelines/scripts/dvc-shared-cache.sh prune >/dev/null)
dry_run_log="$(cat "$log_file")"
assert_contains "$dry_run_log" "gc --workspace --force --dry"
assert_contains "$dry_run_log" "--projects"
if find "$test_root" -maxdepth 1 -type d -name '.dvc-gc.*' | grep -q .; then
  echo "Temporary DVC GC worktree was not removed" >&2
  exit 1
fi

: > "$log_file"
(cd "$fixture" && "${environment[@]}" bash ml-pipelines/scripts/dvc-shared-cache.sh prune --apply >/dev/null)
apply_log="$(cat "$log_file")"
assert_contains "$apply_log" "gc --workspace --force"
assert_not_contains "$apply_log" "--dry"

exec 8>"$cache_dir.gc.lock"
flock -n 8
assert_fails_with \
  "Another shared-cache prune is running" \
  bash -c 'cd "$1" && shift && "$@"' _ "$fixture" \
  "${environment[@]}" bash ml-pipelines/scripts/dvc-shared-cache.sh prune
flock -u 8

assert_fails_with \
  "Retained Git ref does not resolve" \
  bash -c 'cd "$1" && shift && "$@"' _ "$fixture" \
  env "DVC_CACHE_RETAIN_REF=missing" "DVC_TEST_CACHE_DIR=$cache_dir" \
  "DVC_TEST_LOG=$log_file" "XDG_CONFIG_HOME=$config_dir" \
  bash ml-pipelines/scripts/dvc-shared-cache.sh status
