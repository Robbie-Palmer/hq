#!/usr/bin/env bash
set -euo pipefail

sample_interval=${THERMAL_MONITOR_SAMPLE_INTERVAL_SECONDS:-5}
fan_alert_rpm=${THERMAL_MONITOR_FAN_ALERT_RPM:-2800}
cpu_alert_millicelsius=${THERMAL_MONITOR_CPU_ALERT_MILLICELSIUS:-65000}
alert_cooldown=${THERMAL_MONITOR_ALERT_COOLDOWN_SECONDS:-30}
status_interval=${THERMAL_MONITOR_STATUS_INTERVAL_SECONDS:-60}
history_retention_samples=${THERMAL_MONITOR_HISTORY_RETENTION_SAMPLES:-20160}
history_trim_interval=${THERMAL_MONITOR_HISTORY_TRIM_INTERVAL_SECONDS:-3600}
state_directory=${STATE_DIRECTORY:-/var/lib/vector-development-thermal-monitor}
status_file=${state_directory}/status.json
history_file=${state_directory}/history.jsonl
cpu_thresholds_celsius=(50 60 62 64 70 76 82 100)

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

read_required_number() {
  local path=$1

  if [[ ! -r ${path} ]]; then
    printf 'required sensor unreadable: %s\n' "${path}" >&2
    return 1
  fi

  cat "${path}"
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
  local fan_percent=$3
  local cpu_millicelsius=$4
  local ec_cpu_millicelsius=$5
  local nvme_millicelsius=$6
  local gpu_runtime_status=$7
  local busiest=$8
  local temporary

  temporary=$(mktemp "${state_directory}/.status.XXXXXX")
  jq --compact-output --null-input \
    --arg timestamp "${timestamp}" \
    --argjson fanRpm "${fan_rpm}" \
    --argjson fanPercent "${fan_percent}" \
    --argjson cpuMillicelsius "${cpu_millicelsius}" \
    --argjson ecCpuMillicelsius "${ec_cpu_millicelsius}" \
    --argjson nvmeMillicelsius "${nvme_millicelsius}" \
    --arg gpuRuntimeStatus "${gpu_runtime_status}" \
    --arg busiestProcesses "${busiest}" \
    '{
      timestamp: $timestamp,
      fanRpm: $fanRpm,
      fanPercent: $fanPercent,
      cpuMillicelsius: $cpuMillicelsius,
      ecCpuMillicelsius: $ecCpuMillicelsius,
      nvmeMillicelsius: $nvmeMillicelsius,
      gpuRuntimeStatus: $gpuRuntimeStatus,
      busiestProcesses: $busiestProcesses
    }' >"${temporary}"
  chmod 0644 "${temporary}"
  cat "${temporary}" >>"${history_file}"
  chmod 0644 "${history_file}"
  mv -f -- "${temporary}" "${status_file}"
}

trim_history() {
  local temporary

  [[ -f ${history_file} ]] || return 0
  temporary=$(mktemp "${state_directory}/.history.XXXXXX")
  tail -n "${history_retention_samples}" "${history_file}" >"${temporary}"
  chmod 0644 "${temporary}"
  mv -f -- "${temporary}" "${history_file}"
}

log_event() {
  local event=$1
  local detail=$2

  printf '%s event=%s %s fan_rpm=%d fan_percent=%d cpu_millicelsius=%d ec_cpu_millicelsius=%d nvme_millicelsius=%d gpu_runtime_status=%s busiest_processes=%s\n' \
    "${timestamp}" \
    "${event}" \
    "${detail}" \
    "${fan_rpm}" \
    "${fan_percent}" \
    "${cpu_millicelsius}" \
    "${ec_cpu_millicelsius}" \
    "${nvme_millicelsius}" \
    "${gpu_runtime_status}" \
    "${busiest}"
}

fan_hwmon=$(find_hwmon msi_wmi_platform)
cpu_zone=$(find_thermal_zone x86_pkg_temp)
nvme_hwmon=$(find_hwmon nvme || true)
gpu_runtime_status_path=/sys/bus/pci/devices/0000:01:00.0/power/runtime_status
fan_percent_path=/sys/devices/platform/msi-ec/cpu/realtime_fan_speed
ec_cpu_temperature_path=/sys/devices/platform/msi-ec/cpu/realtime_temperature

last_alert=0
last_status=0
last_trim=0
last_fan_rpm=-1
last_fan_percent=-1
last_ec_cpu_millicelsius=-1
busiest=$(top_processes)

while true; do
  now=$(date +%s)
  timestamp=$(date --utc --iso-8601=seconds)
  fan_rpm=$(read_required_number "${fan_hwmon}/fan1_input")
  fan_percent=$(read_required_number "${fan_percent_path}")
  cpu_millicelsius=$(read_required_number "${cpu_zone}/temp")
  ec_cpu_celsius=$(read_required_number "${ec_cpu_temperature_path}")
  ec_cpu_millicelsius=$((ec_cpu_celsius * 1000))
  nvme_millicelsius=$(read_number "${nvme_hwmon}/temp2_input")
  gpu_runtime_status=$(cat "${gpu_runtime_status_path}" 2>/dev/null || printf 'unknown')

  event_detected=false
  if ((last_fan_rpm >= 0)); then
    if ((last_fan_rpm == 0 && fan_rpm > 0)); then
      event_detected=true
      fan_state_event=started
    elif ((last_fan_rpm > 0 && fan_rpm == 0)); then
      event_detected=true
      fan_state_event=stopped
    else
      fan_state_event=
    fi
  else
    fan_state_event=
  fi

  if ((last_fan_percent >= 0 && last_fan_percent != fan_percent)); then
    event_detected=true
    fan_percent_event=true
  else
    fan_percent_event=false
  fi

  threshold_events=()
  if ((last_ec_cpu_millicelsius >= 0)); then
    for threshold_celsius in "${cpu_thresholds_celsius[@]}"; do
      threshold_millicelsius=$((threshold_celsius * 1000))
      if ((last_ec_cpu_millicelsius < threshold_millicelsius \
        && ec_cpu_millicelsius >= threshold_millicelsius)); then
        event_detected=true
        threshold_events+=("${threshold_celsius}:rising")
      elif ((last_ec_cpu_millicelsius >= threshold_millicelsius \
        && ec_cpu_millicelsius < threshold_millicelsius)); then
        event_detected=true
        threshold_events+=("${threshold_celsius}:falling")
      fi
    done
  fi

  if [[ ${event_detected} == true ]]; then
    busiest=$(top_processes)
    if [[ -n ${fan_state_event} ]]; then
      log_event fan_state "state=${fan_state_event}"
    fi
    if [[ ${fan_percent_event} == true ]]; then
      log_event fan_percent \
        "previous_percent=${last_fan_percent} current_percent=${fan_percent}"
    fi
    for threshold_event in "${threshold_events[@]}"; do
      threshold_celsius=${threshold_event%%:*}
      direction=${threshold_event##*:}
      log_event cpu_threshold \
        "threshold_celsius=${threshold_celsius} direction=${direction}"
    done
  fi

  if ((
    (fan_rpm >= fan_alert_rpm || cpu_millicelsius >= cpu_alert_millicelsius)
      && now - last_alert >= alert_cooldown
  )); then
    busiest=$(top_processes)
    printf '%s fan_rpm=%d fan_percent=%d cpu_millicelsius=%d ec_cpu_millicelsius=%d nvme_millicelsius=%d gpu_runtime_status=%s busiest_processes=%s\n' \
      "${timestamp}" \
      "${fan_rpm}" \
      "${fan_percent}" \
      "${cpu_millicelsius}" \
      "${ec_cpu_millicelsius}" \
      "${nvme_millicelsius}" \
      "${gpu_runtime_status}" \
      "${busiest}"
    last_alert=${now}
  fi

  if ((now - last_status >= status_interval)); then
    busiest=$(top_processes)
    write_status \
      "${timestamp}" \
      "${fan_rpm}" \
      "${fan_percent}" \
      "${cpu_millicelsius}" \
      "${ec_cpu_millicelsius}" \
      "${nvme_millicelsius}" \
      "${gpu_runtime_status}" \
      "${busiest}"
    last_status=${now}
  fi

  if ((now - last_trim >= history_trim_interval)); then
    trim_history
    last_trim=${now}
  fi

  last_fan_rpm=${fan_rpm}
  last_fan_percent=${fan_percent}
  last_ec_cpu_millicelsius=${ec_cpu_millicelsius}

  sleep "${sample_interval}"
done
