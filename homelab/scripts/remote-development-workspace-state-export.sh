#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 WORKSPACE_SOURCE EMPTY_EXPORT_DIRECTORY" >&2
  exit 2
fi

workspace_source=$1
export_directory=$2
sqlite_bin=${SQLITE_BIN:-sqlite3}
find_bin=${FIND_BIN:-find}

if [ ! -d "${workspace_source}" ]; then
  echo "workspace source is not a directory" >&2
  exit 1
fi
workspace_source=$(cd -- "${workspace_source}" && pwd -P)
if [ -e "${export_directory}" ]; then
  echo "workspace state export target must not exist" >&2
  exit 1
fi

userdata_directory="${workspace_source}/home/.t3/userdata"
if [ ! -d "${userdata_directory}" ]; then
  echo "T3 Code userdata is not available" >&2
  exit 1
fi

umask 077
database_export_directory="${export_directory}/t3-databases"
worktree_export_directory="${export_directory}/in-flight-worktrees"
install -d -m 0700 "${database_export_directory}" "${worktree_export_directory}"

for database_name in statev2.sqlite server-owner.sqlite; do
  database_path="${userdata_directory}/${database_name}"
  if [ ! -r "${database_path}" ]; then
    echo "required T3 Code database is not readable" >&2
    exit 1
  fi
  "${sqlite_bin}" "${database_path}" \
    ".timeout 5000" \
    ".backup '${database_export_directory}/${database_name}'"
done

declare -A visited_worktrees=()
worktree_count=0
skipped_worktree_count=0

export_worktree() {
  local git_marker=$1
  local candidate worktree relative_path state_id state_directory
  local dirty_status unpushed_commit_count branch head upstream
  local remote_refs_current=true

  candidate=$(dirname -- "${git_marker}")
  if ! worktree=$(git -C "${candidate}" rev-parse --show-toplevel 2>/dev/null); then
    skipped_worktree_count=$((skipped_worktree_count + 1))
    return
  fi
  worktree=$(cd -- "${worktree}" && pwd -P)
  case "${worktree}" in
    "${workspace_source}/workspaces"/*|"${workspace_source}/home/.t3/worktrees"/*) ;;
    *) return ;;
  esac
  if [ -n "${visited_worktrees[${worktree}]:-}" ]; then
    return
  fi
  visited_worktrees["${worktree}"]=1

  dirty_status=$(git -C "${worktree}" status --porcelain=v1 --untracked-files=all)
  if git -C "${worktree}" rev-parse --verify HEAD >/dev/null 2>&1; then
    if GIT_TERMINAL_PROMPT=0 git -C "${worktree}" fetch --all --prune \
      --no-recurse-submodules --quiet; then
      unpushed_commit_count=$(git -C "${worktree}" rev-list --count HEAD --not --remotes)
    else
      remote_refs_current=false
      unpushed_commit_count=$(git -C "${worktree}" rev-list --count HEAD)
      echo "remote refresh failed; exporting complete reachable history" >&2
    fi
  else
    unpushed_commit_count=0
  fi
  if [ -z "${dirty_status}" ] && [ "${unpushed_commit_count}" -eq 0 ]; then
    return
  fi

  relative_path=${worktree#"${workspace_source}/"}
  state_id=$(printf '%s' "${relative_path}" | sha256sum | cut -c1-16)
  state_directory="${worktree_export_directory}/${state_id}"
  install -d -m 0700 "${state_directory}"

  branch=$(git -C "${worktree}" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'detached')
  head=$(git -C "${worktree}" rev-parse --verify HEAD 2>/dev/null || printf 'unborn')
  upstream=$(git -C "${worktree}" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || printf 'none')
  jq --null-input \
    --arg relativePath "${relative_path}" \
    --arg branch "${branch}" \
    --arg head "${head}" \
    --arg upstream "${upstream}" \
    --argjson unpushedCommitCount "${unpushed_commit_count}" \
    --argjson remoteRefsCurrent "${remote_refs_current}" \
    '{schemaVersion: 1, relativePath: $relativePath, branch: $branch,
      head: $head, upstream: (if $upstream == "none" then null else $upstream end),
      unpushedCommitCount: $unpushedCommitCount, remoteRefsCurrent: $remoteRefsCurrent}' \
    >"${state_directory}/metadata.json"

  git -C "${worktree}" status --short --branch \
    >"${state_directory}/status.txt"
  if [ "${head}" != unborn ]; then
    git -C "${worktree}" diff --binary HEAD -- \
      >"${state_directory}/tracked.patch"
  else
    empty_tree=$(git -C "${worktree}" hash-object -t tree /dev/null)
    git -C "${worktree}" diff --binary --cached "${empty_tree}" -- \
      >"${state_directory}/tracked.patch"
    git -C "${worktree}" diff --binary -- \
      >"${state_directory}/unstaged.patch"
  fi

  untracked_list=$(mktemp "${export_directory}/untracked.XXXXXX")
  git -C "${worktree}" ls-files --others --exclude-standard -z \
    >"${untracked_list}"
  if [ -s "${untracked_list}" ]; then
    tar --create --gzip --null \
      --directory="${worktree}" \
      --files-from="${untracked_list}" \
      --file="${state_directory}/untracked.tar.gz"
  fi
  rm -f -- "${untracked_list}"

  if [ "${unpushed_commit_count}" -gt 0 ]; then
    if [ "${remote_refs_current}" = true ]; then
      git -C "${worktree}" bundle create \
        "${state_directory}/unpushed.bundle" HEAD --not --remotes
    else
      git -C "${worktree}" bundle create \
        "${state_directory}/unpushed.bundle" HEAD
    fi
  fi
  worktree_count=$((worktree_count + 1))
}

for search_root in \
  "${workspace_source}/workspaces" \
  "${workspace_source}/home/.t3/worktrees"; do
  if [ ! -d "${search_root}" ]; then
    continue
  fi
  discovery_list=$(mktemp "${export_directory}/worktree-discovery.XXXXXX")
  if ! "${find_bin}" "${search_root}" -xdev \
    \( -name node_modules -o -name .pnpm-store -o -name target \
       -o -name .venv -o -name vendor \) -prune -o \
    -name .git -prune -print0 >"${discovery_list}"; then
    rm -f -- "${discovery_list}"
    echo "worktree discovery failed" >&2
    exit 1
  fi
  while IFS= read -r -d '' git_marker; do
    export_worktree "${git_marker}"
  done <"${discovery_list}"
  rm -f -- "${discovery_list}"
done

jq --null-input \
  --argjson exportedWorktrees "${worktree_count}" \
  --argjson skippedWorktrees "${skipped_worktree_count}" \
  '{schemaVersion: 1, exportedWorktrees: $exportedWorktrees,
    skippedWorktrees: $skippedWorktrees}' \
  >"${export_directory}/manifest.json"

if [ "${skipped_worktree_count}" -gt 0 ]; then
  echo "workspace state export skipped ${skipped_worktree_count} worktree(s)" >&2
  exit 1
fi

echo "T3 Code databases and in-flight worktree changes exported"
