#!/usr/bin/env bash
set -euo pipefail

sample_interval=${THERMAL_MONITOR_SAMPLE_INTERVAL_SECONDS:-5}
fan_alert_rpm=${THERMAL_MONITOR_FAN_ALERT_RPM:-2800}
cpu_alert_millicelsius=${THERMAL_MONITOR_CPU_ALERT_MILLICELSIUS:-65000}
alert_cooldown=${THERMAL_MONITOR_ALERT_COOLDOWN_SECONDS:-30}
status_interval=${THERMAL_MONITOR_STATUS_INTERVAL_SECONDS:-60}
state_directory=${STATE_DIRECTORY:-/var/lib/vector-development-thermal-monitor}
status_file=${state_directory}/status.json

find_hwmon() {
  local expected_name=$1
  local candidate

  for candidate in /sys/class/hwmon/hwmon*; do
    [[ -r ${candidate}/name ]] || continue
    [[ $(cat "${candidate}/name") == "${expected_name}" ]] || continue
    printf '%s\n' "${candidate}"
    return 0
  done

  return 1
}

find_thermal_zone() {
  local expected_type=$1
  local candidate

  for candidate in /sys/class/thermal/thermal_zone*; do
    [[ -r ${candidate}/type ]] || continue
    [[ $(cat "${candidate}/type") == "${expected_type}" ]] || continue
    printf '%s\n' "${candidate}"
    return 0
  done

  return 1
}

read_number() {
  local path=$1

  if [[ -r ${path} ]]; then
    cat "${path}"
  else
    printf '0\n'
  fi
}

top_processes() {
  ps --no-headers \
    -eo pid,ppid,user,comm,%cpu,%mem \
    --sort=-%cpu \
    | awk '
        NR <= 5 {
          gsub(/^[[:space:]]+/, "")
          gsub(/[[:space:]]+/, " ")
          records = records separator $0
          separator = ";"
        }
        END { print records }
      '
}

write_status() {
  local timestamp=$1
  local fan_rpm=$2
  local cpu_millicelsius=$3
  local nvme_millicelsius=$4
  local gpu_runtime_status=$5
  local busiest=$6
  local temporary

  temporary=$(mktemp "${state_directory}/.status.XXXXXX")
  jq --null-input \
    --arg timestamp "${timestamp}" \
    --argjson fanRpm "${fan_rpm}" \
    --argjson cpuMillicelsius "${cpu_millicelsius}" \
    --argjson nvmeMillicelsius "${nvme_millicelsius}" \
    --arg gpuRuntimeStatus "${gpu_runtime_status}" \
    --arg busiestProcesses "${busiest}" \
    '{
      timestamp: $timestamp,
      fanRpm: $fanRpm,
      cpuMillicelsius: $cpuMillicelsius,
      nvmeMillicelsius: $nvmeMillicelsius,
      gpuRuntimeStatus: $gpuRuntimeStatus,
      busiestProcesses: $busiestProcesses
    }' >"${temporary}"
  chmod 0644 "${temporary}"
  mv -f -- "${temporary}" "${status_file}"
}

fan_hwmon=$(find_hwmon msi_wmi_platform)
cpu_zone=$(find_thermal_zone x86_pkg_temp)
nvme_hwmon=$(find_hwmon nvme || true)
gpu_runtime_status_path=/sys/bus/pci/devices/0000:01:00.0/power/runtime_status

last_alert=0
last_status=0
busiest=$(top_processes)

while true; do
  now=$(date +%s)
  timestamp=$(date --utc --iso-8601=seconds)
  fan_rpm=$(read_number "${fan_hwmon}/fan1_input")
  cpu_millicelsius=$(read_number "${cpu_zone}/temp")
  nvme_millicelsius=$(read_number "${nvme_hwmon}/temp2_input")
  gpu_runtime_status=$(cat "${gpu_runtime_status_path}" 2>/dev/null || printf 'unknown')

  if ((fan_rpm >= fan_alert_rpm || cpu_millicelsius >= cpu_alert_millicelsius)); then
    if ((now - last_alert >= alert_cooldown)); then
      busiest=$(top_processes)
      printf '%s fan_rpm=%d cpu_millicelsius=%d nvme_millicelsius=%d gpu_runtime_status=%s busiest_processes=%s\n' \
        "${timestamp}" \
        "${fan_rpm}" \
        "${cpu_millicelsius}" \
        "${nvme_millicelsius}" \
        "${gpu_runtime_status}" \
        "${busiest}"
      last_alert=${now}
    fi
  fi

  if ((now - last_status >= status_interval)); then
    busiest=$(top_processes)
    write_status \
      "${timestamp}" \
      "${fan_rpm}" \
      "${cpu_millicelsius}" \
      "${nvme_millicelsius}" \
      "${gpu_runtime_status}" \
      "${busiest}"
    last_status=${now}
  fi

  sleep "${sample_interval}"
done
