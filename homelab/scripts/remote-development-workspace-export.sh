#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 WORKSPACE_SOURCE OUTPUT_ARCHIVE" >&2
  exit 2
fi

source_directory=$1
output_archive=$2
exclude_file=${WORKSPACE_EXPORT_EXCLUDES:-/etc/remote-development-workspace-backup/export-excludes.txt}

if [ ! -d "${source_directory}" ]; then
  echo "workspace source is not a directory" >&2
  exit 1
fi
source_directory=$(CDPATH= cd -P "${source_directory}" && pwd)
if [ ! -r "${exclude_file}" ]; then
  echo "workspace export exclude file is not readable" >&2
  exit 1
fi
case ${output_archive} in
  /*) ;;
  *) output_archive=$(pwd)/${output_archive} ;;
esac
output_directory=$(dirname "${output_archive}")
if [ ! -d "${output_directory}" ]; then
  echo "output archive directory does not exist" >&2
  exit 1
fi
output_archive=$(CDPATH= cd -P "${output_directory}" && pwd)/$(basename "${output_archive}")
case ${output_archive} in
  "${source_directory}"/*)
    echo "output archive must be outside the workspace source" >&2
    exit 1
    ;;
esac
if [ -e "${output_archive}" ]; then
  echo "output archive already exists" >&2
  exit 1
fi

umask 077
tar \
  --exclude-from="${exclude_file}" \
  --create \
  --gzip \
  --file="${output_archive}" \
  --directory="${source_directory}" \
  .

echo "credential-safe workspace export created at ${output_archive}"
