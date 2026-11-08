#!/usr/bin/env bash
set -euo pipefail

image=ghcr.io/robbie-palmer/pathologize-cucim-benchmark:0.1.0
repository_root=$(git rev-parse --show-toplevel)
driver_version=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head --lines=1)
gpu_uuid=$(nvidia-smi --query-gpu=uuid --format=csv,noheader | head --lines=1)
driver_library=$(
  find /nix/store -type f \
    -path "*-nvidia-x11-${driver_version}/lib/libcuda.so.${driver_version}" \
    -print -quit
)

if [[ -z ${driver_library} ]]; then
  echo "could not find the NVIDIA ${driver_version} host driver libraries" >&2
  exit 1
fi

driver_library_root=$(dirname -- "${driver_library}")
driver_context=$(
  mktemp --directory \
    "${repository_root}/ml-pipelines/pathologize-tiling-benchmark/data/cucim-driver.XXXXXX"
)
trap 'rm --recursive --force "${driver_context}"' EXIT
mkdir --parents "${driver_context}/driver-libs"
for library in \
  libcuda.so \
  libnvidia-gpucomp.so \
  libnvidia-nvvm.so \
  libnvidia-nvvm70.so \
  libnvidia-ptxjitcompiler.so; do
  cp --archive "${driver_library_root}/${library}"* "${driver_context}/driver-libs/"
done

driver_image=${image}-driver-${driver_version}
docker build \
  --file "${repository_root}/homelab/images/pathologize-cucim-benchmark/driver.Dockerfile" \
  --pull=false \
  --provenance=false \
  --tag "${driver_image}" \
  "${driver_context}" >&2

for device in /dev/nvidia0 /dev/nvidiactl /dev/nvidia-uvm; do
  if [[ ! -e ${device} ]]; then
    echo "${device} is required" >&2
    exit 1
  fi
done

run=(docker run --rm \
  --cpus=16 \
  --memory=24g \
  --device=/dev/nvidia0 \
  --device=/dev/nvidiactl \
  --device=/dev/nvidia-uvm \
  --env PATHOLOGIZE_NVIDIA_DRIVER_VERSION="${driver_version}" \
  --env PATHOLOGIZE_NVIDIA_GPU_UUID="${gpu_uuid}" \
  --user 1000:1000 \
  "${driver_image}" \
  "$@")

result_path=${PATHOLOGIZE_CUCIM_RESULT:-}
if [[ -n ${result_path} ]]; then
  case ${result_path} in
    "${repository_root}"/*) ;;
    *)
      echo "PATHOLOGIZE_CUCIM_RESULT must be inside ${repository_root}" >&2
      exit 1
      ;;
  esac
  mkdir --parents "$(dirname -- "${result_path}")"
  "${run[@]}" >"${result_path}"
else
  "${run[@]}"
fi
