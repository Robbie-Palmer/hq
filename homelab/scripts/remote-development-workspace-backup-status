#!/usr/bin/env bash
set -euo pipefail

config_file=${WORKSPACE_BACKUP_CONFIG:-/etc/remote-development-workspace-backup/config}
if [ ! -r "${config_file}" ]; then
  echo '{"schemaVersion":1,"state":"unconfigured","fresh":false}'
  exit 1
fi

# shellcheck source=/dev/null
source "${config_file}"

if [ ! -r "${BACKUP_STATUS_FILE}" ]; then
  jq --null-input \
    --arg workspaceId "${WORKSPACE_ID}" \
    --arg destinationProvider "${DESTINATION_PROVIDER}" \
    '{
      schemaVersion: 1,
      workspaceId: $workspaceId,
      destinationProvider: $destinationProvider,
      state: "never_run",
      fresh: false,
      ageSeconds: null
    }'
  exit 1
fi

now=$(date +%s)
jq \
  --argjson now "${now}" \
  --argjson maximumAgeSeconds "${MAXIMUM_AGE_SECONDS}" \
  '.lastSuccessUnix as $lastSuccess
   | . + {
       maximumAgeSeconds: $maximumAgeSeconds,
       ageSeconds: (if $lastSuccess == null then null else ($now - $lastSuccess) end),
       fresh: (
         $lastSuccess != null
         and ($now - $lastSuccess) >= 0
         and ($now - $lastSuccess) <= $maximumAgeSeconds
       )
     }' "${BACKUP_STATUS_FILE}"
