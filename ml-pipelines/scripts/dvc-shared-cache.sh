#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  dvc-shared-cache.sh status [--verbose]
  dvc-shared-cache.sh prune [--apply]

Prune is a dry run unless --apply is provided. It checks out the retained Git
ref in a temporary worktree and preserves only DVC objects referenced there.
Feature worktrees are ephemeral and never become cache-retention roots.

Set DVC_CACHE_RETAIN_REF to override the default retained ref, origin/main.
EOF
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

command_name="$1"
shift

apply=false
verbose=false
case "$command_name" in
  status)
    if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--verbose") ]]; then
      usage >&2
      exit 2
    fi
    if [[ ${1:-} == "--verbose" ]]; then
      verbose=true
    fi
    ;;
  prune)
    if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--apply") ]]; then
      usage >&2
      exit 2
    fi
    if [[ ${1:-} == "--apply" ]]; then
      apply=true
    fi
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

repository_root="$(git rev-parse --show-toplevel)"
dvc_runner="$repository_root/ml-pipelines/scripts/dvc.sh"
retained_ref="${DVC_CACHE_RETAIN_REF:-origin/main}"
if [[ ! -x $dvc_runner ]]; then
  echo "DVC runner is not executable: $dvc_runner" >&2
  exit 1
fi
if ! git -C "$repository_root" rev-parse --verify --quiet "$retained_ref^{commit}" >/dev/null; then
  echo "Retained Git ref does not resolve to a commit: $retained_ref" >&2
  exit 1
fi
retained_commit="$(git -C "$repository_root" rev-parse "$retained_ref^{commit}")"

declare -A seen_projects=()
declare -a relative_projects=()
while IFS= read -r -d '' config_path; do
  if [[ $config_path != */.dvc/config ]]; then
    continue
  fi
  relative_project="${config_path%/.dvc/config}"
  if [[ -z ${seen_projects[$relative_project]:-} ]]; then
    seen_projects[$relative_project]=1
    relative_projects+=("$relative_project")
  fi
done < <(git -C "$repository_root" ls-tree -r --name-only -z "$retained_ref")

if [[ ${#relative_projects[@]} -eq 0 ]]; then
  echo "No DVC projects found at retained ref: $retained_ref" >&2
  exit 1
fi

probe_config="$(git -C "$repository_root" ls-files '*/.dvc/config' | sed -n '1p')"
if [[ -z $probe_config ]]; then
  echo "No DVC project is available in the current worktree" >&2
  exit 1
fi
probe_project="$repository_root/${probe_config%/.dvc/config}"
if [[ -n ${DVC_GLOBAL_CONFIG_DIR:-} ]]; then
  global_dvc_config="$DVC_GLOBAL_CONFIG_DIR/config"
elif [[ -n ${XDG_CONFIG_HOME:-} ]]; then
  global_dvc_config="$XDG_CONFIG_HOME/dvc/config"
else
  global_dvc_config="$HOME/.config/dvc/config"
fi
configured_site_cache=""
if [[ -f $global_dvc_config ]]; then
  configured_site_cache="$(awk -F '=' '
    /^\[core\][[:space:]]*$/ { in_core = 1; next }
    /^\[/ { in_core = 0 }
    in_core && /^[[:space:]]*site_cache_dir[[:space:]]*=/ {
      value = $2
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "$global_dvc_config")"
fi
if [[ -n $configured_site_cache ]]; then
  export DVC_SITE_CACHE_DIR="$configured_site_cache"
fi
shared_cache="$(cd "$probe_project" && "$dvc_runner" cache dir)"
shared_cache="$(realpath -m "$shared_cache")"
if [[ $shared_cache == "/" || $shared_cache == "$repository_root" ]]; then
  echo "Refusing unsafe shared cache path: $shared_cache" >&2
  exit 1
fi

worktree_count="$(git -C "$repository_root" worktree list --porcelain | awk '$1 == "worktree" { count += 1 } END { print count + 0 }')"
printf 'cache: %s\n' "$shared_cache"
printf 'retained ref: %s (%s)\n' "$retained_ref" "$retained_commit"
printf 'retained DVC projects: %s\n' "${#relative_projects[@]}"
printf 'ephemeral worktrees ignored: %s\n' "$worktree_count"
du -sh "$shared_cache"

if [[ $command_name == "status" ]]; then
  if [[ $verbose == true ]]; then
    printf '%s\n' "${relative_projects[@]}"
  fi
  exit 0
fi

lock_path="${shared_cache}.gc.lock"
exec 9>"$lock_path"
if ! flock -n 9; then
  echo "Another shared-cache prune is running: $lock_path" >&2
  exit 1
fi

temporary_parent="$(mktemp -d "$(dirname "$shared_cache")/.dvc-gc.XXXXXX")"
retained_worktree="$temporary_parent/worktree"
cleanup() {
  if [[ -d $retained_worktree ]]; then
    git -C "$repository_root" worktree remove --force "$retained_worktree" >/dev/null 2>&1 || true
  fi
  rmdir "$temporary_parent" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$repository_root" worktree add --detach "$retained_worktree" "$retained_ref" >/dev/null

declare -a retained_projects=()
for relative_project in "${relative_projects[@]}"; do
  project="$retained_worktree/$relative_project"
  project_cache="$(cd "$project" && "$dvc_runner" cache dir)"
  project_cache="$(realpath -m "$project_cache")"
  if [[ $project_cache != "$shared_cache" ]]; then
    echo "Refusing project with another cache: $project -> $project_cache" >&2
    exit 1
  fi
  retained_projects+=("$project")
done

declare -a gc_args=(gc --workspace --force)
if [[ $apply == false ]]; then
  gc_args+=(--dry)
  echo "mode: dry run"
else
  echo "mode: apply"
fi
if [[ ${#retained_projects[@]} -gt 1 ]]; then
  gc_args+=(--projects "${retained_projects[@]:1}")
fi

anchor_project="${retained_projects[0]}"
(cd "$anchor_project" && "$dvc_runner" "${gc_args[@]}")
