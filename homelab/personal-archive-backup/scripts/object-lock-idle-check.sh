#!/usr/bin/env bash
set -euo pipefail

service_name=personal-archive-backup.service
timer_name=personal-archive-backup.timer
archive_id=robbie-vector-gp68hx-13vh-home-migration

command -v systemctl >/dev/null 2>&1 || {
  echo "systemctl is required to prove the archive host is idle" >&2
  exit 1
}
user_manager_state=active
if systemctl --user show-environment >/dev/null 2>&1; then
  service_state=$(systemctl --user is-active "${service_name}" 2>/dev/null || true)
  timer_state=$(systemctl --user is-active "${timer_name}" 2>/dev/null || true)
  timer_enabled=$(systemctl --user is-enabled "${timer_name}" 2>/dev/null || true)
else
  user_manager_state=$(systemctl is-active "user@$(id -u).service" 2>/dev/null || true)
  case "${user_manager_state}" in
    inactive|failed)
      service_state=manager-inactive
      timer_state=manager-inactive
      timer_enabled=manager-inactive
      ;;
    *)
      echo "the user service manager is unavailable while its system unit is ${user_manager_state:-unknown}; idle state is unproven" >&2
      exit 1
      ;;
  esac
fi

if [[ "${service_state}" = active ]] || [[ "${service_state}" = activating ]]; then
  echo "the personal archive backup service is running" >&2
  exit 1
fi
if [[ "${timer_state}" = active ]] || [[ "${timer_enabled}" = enabled ]]; then
  echo "the personal archive backup timer is enabled" >&2
  exit 1
fi
if pgrep -f '(^|/)(restic|personal-archive-backup\.sh)( |$)' >/dev/null 2>&1; then
  echo "a restic or personal archive process is running" >&2
  exit 1
fi

jq --null-input \
  --arg archiveId "${archive_id}" \
  --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg host "$(hostname)" \
  --arg serviceState "${service_state:-unknown}" \
  --arg timerState "${timer_state:-unknown}" \
  --arg timerEnabled "${timer_enabled:-unknown}" \
  --arg userManagerState "${user_manager_state}" \
  '{schemaVersion: 1, archiveId: $archiveId, checkedAt: $checkedAt,
    host: $host, idle: true, serviceState: $serviceState,
    timerState: $timerState, timerEnabled: $timerEnabled,
    userManagerState: $userManagerState}'
