#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
manifest=${project_root}/fixtures/tiff-gpu-manifest.json
destination=${project_root}/data/tiff-gpu
temporary_root=$(mktemp -d)
trap 'rm --recursive --force "${temporary_root}"' EXIT

for command in curl jq sha256sum tar; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required" >&2
    exit 1
  fi
done

mkdir --parents "${destination}"

source_count=$(jq '.sources | length' "${manifest}")
for ((source_index = 0; source_index < source_count; source_index++)); do
  source_id=$(jq --raw-output ".sources[${source_index}].id" "${manifest}")
  source_url=$(jq --raw-output ".sources[${source_index}].url" "${manifest}")
  source_file=${temporary_root}/${source_id}
  member_count=$(jq ".sources[${source_index}].members | length" "${manifest}")

  source_complete=true
  for ((member_index = 0; member_index < member_count; member_index++)); do
    member_path=$(jq --raw-output ".sources[${source_index}].members[${member_index}].path" "${manifest}")
    expected_sha256=$(jq --raw-output ".sources[${source_index}].members[${member_index}].sha256" "${manifest}")
    if [[ ! -f ${destination}/${member_path} ]] \
      || [[ $(sha256sum "${destination}/${member_path}" | cut --delimiter=' ' --fields=1) != "${expected_sha256}" ]]; then
      source_complete=false
      break
    fi
  done
  if [[ ${source_complete} == true ]]; then
    continue
  fi

  curl --fail --location --retry 3 --output "${source_file}" "${source_url}"

  if [[ ${source_url} == *.tar ]]; then
    for ((member_index = 0; member_index < member_count; member_index++)); do
      member_path=$(jq --raw-output ".sources[${source_index}].members[${member_index}].path" "${manifest}")
      tar --extract --file "${source_file}" --directory "${destination}" "${member_path}"
    done
  else
    if [[ ${member_count} -ne 1 ]]; then
      echo "non-archive source ${source_id} must contain one member" >&2
      exit 1
    fi
    member_path=$(jq --raw-output ".sources[${source_index}].members[0].path" "${manifest}")
    mkdir --parents "${destination}/$(dirname -- "${member_path}")"
    install --mode=0444 "${source_file}" "${destination}/${member_path}"
  fi
done

jq --raw-output '.sources[].members[] | "\(.sha256)  \(.path)"' "${manifest}" \
  | (cd "${destination}" && sha256sum --check --strict -)

jq --raw-output '.sources[].members[] | "\(.bytes) \(.path)"' "${manifest}" \
  | while read -r expected_bytes member_path; do
      actual_bytes=$(stat --format=%s "${destination}/${member_path}")
      if [[ ${actual_bytes} -ne ${expected_bytes} ]]; then
        echo "${member_path}: expected ${expected_bytes} bytes, found ${actual_bytes}" >&2
        exit 1
      fi
    done
