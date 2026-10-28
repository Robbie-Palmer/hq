#!/usr/bin/env bash
set -euo pipefail

product_name=$(cat /sys/class/dmi/id/product_name)
board_name=$(cat /sys/class/dmi/id/board_name)

if [[ ${product_name} != "Vector GP68HX 13VH" || ${board_name} != "MS-15M1" ]]; then
  echo "refusing MSI EC writes on ${product_name} board ${board_name}" >&2
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
case ${firmware} in
  15M1IMS1.109 | 15M1IMS1.110 | 15M1IMS1.113 | 15M1IMS1.114) ;;
  *)
    echo "refusing MSI EC writes on unsupported firmware ${firmware}" >&2
    exit 1
    ;;
esac

grep -Fx silent "${msi_ec}/available_fan_modes" >/dev/null
grep -Fx eco "${msi_ec}/available_shift_modes" >/dev/null

printf 'eco\n' >"${msi_ec}/shift_mode"
printf 'silent\n' >"${msi_ec}/fan_mode"

test "$(cat "${msi_ec}/fan_mode")" = silent
test "$(cat "${msi_ec}/shift_mode")" = eco

echo "applied MSI quiet profile to EC firmware ${firmware}"
