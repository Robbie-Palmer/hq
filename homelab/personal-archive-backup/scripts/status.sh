#!/usr/bin/env bash
set -euo pipefail

config_file=${PERSONAL_ARCHIVE_CONFIG:-$HOME/.config/personal-archive-backup/config}
if [ ! -r "${config_file}" ]; then
  echo '{"schemaVersion":1,"state":"unconfigured","fresh":false}'
  exit 1
fi
# shellcheck source=/dev/null
source "${config_file}"

if [ ! -r "${BACKUP_STATUS_FILE}" ]; then
  jq --null-input --arg archiveId "${ARCHIVE_ID}" \
    '{schemaVersion: 1, archiveId: $archiveId, state: "never_run", fresh: false, ageSeconds: null}'
  exit 1
fi

now=$(date +%s)
jq --arg mode "${OPERATION_MODE:-scheduled}" --argjson now "${now}" \
  --argjson maximumAgeSeconds "${MAXIMUM_AGE_SECONDS}" \
  '.lastSuccessUnix as $lastSuccess | . + {
    operationMode: $mode,
    monitoringExpected: ($mode == "scheduled"),
    maximumAgeSeconds: $maximumAgeSeconds,
    ageSeconds: (if $lastSuccess == null then null else ($now - $lastSuccess) end),
    fresh: (if $mode == "scheduled" then
      ($lastSuccess != null and ($now - $lastSuccess) >= 0 and
        ($now - $lastSuccess) <= $maximumAgeSeconds)
      else null end)
  }' "${BACKUP_STATUS_FILE}"
