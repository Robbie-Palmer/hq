#!/usr/bin/env bash
set -euo pipefail

action=${1:?expected apply, check, or restore}
case ${action} in
  apply | check | restore) ;;
  *)
    echo "expected apply, check, or restore" >&2
    exit 2
    ;;
esac

product_name=$(cat /sys/class/dmi/id/product_name)
board_name=$(cat /sys/class/dmi/id/board_name)

if [[ ${product_name} != "Vector GP68HX 13VH" || ${board_name} != "MS-15M1" ]]; then
  echo "refusing fan-curve access on ${product_name} board ${board_name}" >&2
  exit 1
fi

msi_ec=/sys/devices/platform/msi-ec
for attribute in fw_version available_fan_modes fan_mode available_shift_modes shift_mode; do
  if [[ ! -r ${msi_ec}/${attribute} ]]; then
    echo "MSI EC attribute is unavailable: ${attribute}" >&2
    exit 1
  fi
done

firmware=$(cat "${msi_ec}/fw_version")
if [[ ${firmware} != "15M1IMS1.109" ]]; then
  echo "refusing fan-curve access on unverified firmware ${firmware}" >&2
  exit 1
fi

grep -Fx advanced "${msi_ec}/available_fan_modes" >/dev/null
grep -Fx silent "${msi_ec}/available_fan_modes" >/dev/null
grep -Fx eco "${msi_ec}/available_shift_modes" >/dev/null

exec 9>/run/lock/vector-development-fan-curve.lock
flock 9

ec_sys_loaded_here=false
cleanup() {
  if [[ ${ec_sys_loaded_here} == true ]]; then
    modprobe -r ec_sys 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ ! -d /sys/module/ec_sys ]]; then
  if [[ ${action} == check ]]; then
    modprobe ec_sys
  else
    modprobe ec_sys write_support=1
  fi
  ec_sys_loaded_here=true
fi

if [[ ${action} != check && $(cat /sys/module/ec_sys/parameters/write_support) != Y ]]; then
  echo "ec_sys is loaded without write support" >&2
  exit 1
fi

ec_io=/sys/kernel/debug/ec/ec0/io
if [[ ! -r ${ec_io} ]]; then
  echo "ACPI EC debug interface is unavailable" >&2
  exit 1
fi
if [[ ${action} != check && ! -w ${ec_io} ]]; then
  echo "ACPI EC debug interface is not writable" >&2
  exit 1
fi

read_bytes() {
  local offset=$1
  local count=$2
  local -a values

  read -r -a values < <(od -An -v -t u1 -j "${offset}" -N "${count}" "${ec_io}")
  printf '%s\n' "${values[*]}"
}

factory_cpu_temperatures="50 57 64 70 76 82 100"
previous_quiet_cpu_temperatures="55 60 65 70 76 82 100"
intermediate_quiet_cpu_temperatures="60 64 68 70 76 82 100"
quiet_cpu_temperatures="60 62 64 70 76 82 100"
expected_cpu_speeds="0 40 50 60 75 89 103"
expected_gpu_temperatures="50 55 60 65 70 75 100"
expected_gpu_speeds="0 50 60 70 82 93 104"

cpu_temperatures=$(read_bytes "$((0x6a))" 7)
cpu_speeds=$(read_bytes "$((0x72))" 7)
gpu_temperatures=$(read_bytes "$((0x82))" 7)
gpu_speeds=$(read_bytes "$((0x8a))" 7)

if [[ ${cpu_speeds} != "${expected_cpu_speeds}" ]]; then
  echo "refusing unexpected CPU fan speeds: ${cpu_speeds}" >&2
  exit 1
fi
if [[ ${gpu_temperatures} != "${expected_gpu_temperatures}" ]]; then
  echo "refusing unexpected GPU temperature curve: ${gpu_temperatures}" >&2
  exit 1
fi
if [[ ${gpu_speeds} != "${expected_gpu_speeds}" ]]; then
  echo "refusing unexpected GPU fan speeds: ${gpu_speeds}" >&2
  exit 1
fi

case ${action} in
  apply)
    if [[ ${cpu_temperatures} != "${factory_cpu_temperatures}" \
      && ${cpu_temperatures} != "${previous_quiet_cpu_temperatures}" \
      && ${cpu_temperatures} != "${intermediate_quiet_cpu_temperatures}" \
      && ${cpu_temperatures} != "${quiet_cpu_temperatures}" ]]; then
      echo "refusing unexpected CPU temperature curve: ${cpu_temperatures}" >&2
      exit 1
    fi
    if [[ ${cpu_temperatures} != "${quiet_cpu_temperatures}" ]]; then
      printf '\074\076\100' \
        | dd of="${ec_io}" bs=1 seek="$((0x6a))" count=3 conv=notrunc status=none
    fi
    printf 'eco\n' >"${msi_ec}/shift_mode"
    printf 'advanced\n' >"${msi_ec}/fan_mode"
    ;;
  check)
    if [[ ${cpu_temperatures} != "${quiet_cpu_temperatures}" ]]; then
      echo "quiet CPU temperature curve is not active: ${cpu_temperatures}" >&2
      exit 1
    fi
    ;;
  restore)
    if [[ ${cpu_temperatures} != "${factory_cpu_temperatures}" \
      && ${cpu_temperatures} != "${previous_quiet_cpu_temperatures}" \
      && ${cpu_temperatures} != "${intermediate_quiet_cpu_temperatures}" \
      && ${cpu_temperatures} != "${quiet_cpu_temperatures}" ]]; then
      echo "refusing unexpected CPU temperature curve: ${cpu_temperatures}" >&2
      exit 1
    fi
    if [[ ${cpu_temperatures} != "${factory_cpu_temperatures}" ]]; then
      printf '\062\071\100' \
        | dd of="${ec_io}" bs=1 seek="$((0x6a))" count=3 conv=notrunc status=none
    fi
    printf 'silent\n' >"${msi_ec}/fan_mode"
    ;;
  *)
    echo "unreachable fan-curve action: ${action}" >&2
    exit 2
    ;;
esac

expected_cpu_temperatures=${quiet_cpu_temperatures}
if [[ ${action} == restore ]]; then
  expected_cpu_temperatures=${factory_cpu_temperatures}
fi

actual_cpu_temperatures=$(read_bytes "$((0x6a))" 7)
if [[ ${actual_cpu_temperatures} != "${expected_cpu_temperatures}" ]]; then
  echo "CPU temperature curve verification failed: ${actual_cpu_temperatures}" >&2
  exit 1
fi

if [[ ${action} != restore ]]; then
  [[ $(cat "${msi_ec}/fan_mode") == advanced ]]
  [[ $(cat "${msi_ec}/shift_mode") == eco ]]
else
  [[ $(cat "${msi_ec}/fan_mode") == silent ]]
fi

echo "${action} verified CPU fan thresholds ${actual_cpu_temperatures} on EC firmware ${firmware}"
