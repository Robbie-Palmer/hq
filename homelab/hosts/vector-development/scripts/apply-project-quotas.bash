findmnt --noheadings --output OPTIONS / | tr ',' '\n' | grep -Fx prjquota >/dev/null
quota_status="$(quotaon --project --print-state / 2>&1 || true)"
if ! grep -F ' is on' <<<"${quota_status}" >/dev/null; then
  quotaon --project /
fi

quota_state="${VECTOR_PROJECT_QUOTA_LAYOUT_VERSION}:$(findmnt --noheadings --output UUID / | tr -d ' ')"
quota_state_file=/var/lib/vector-development/project-quota-layout
if [[ "$(cat "${quota_state_file}" 2>/dev/null || true)" != "${quota_state}" ]]; then
  find "${VECTOR_OPERATOR_DATA_PATH}" -xdev ! -type l -exec chattr -p "${VECTOR_OPERATOR_PROJECT_ID}" {} +
  find "${VECTOR_CACHE_DATA_PATH}" -xdev ! -type l -exec chattr -p "${VECTOR_CACHE_PROJECT_ID}" {} +
fi

chattr +P "${VECTOR_OPERATOR_DATA_PATH}"
setquota --project "${VECTOR_OPERATOR_PROJECT_ID}" 0 "${VECTOR_OPERATOR_BLOCK_HARD_LIMIT}" 0 "${VECTOR_OPERATOR_INODE_HARD_LIMIT}" /
chattr +P "${VECTOR_CACHE_DATA_PATH}"
setquota --project "${VECTOR_CACHE_PROJECT_ID}" 0 "${VECTOR_CACHE_BLOCK_HARD_LIMIT}" 0 "${VECTOR_CACHE_INODE_HARD_LIMIT}" /

repquota --project --verbose --no-names --output=csv / \
  | awk -F, \
    -v operator_id="#${VECTOR_OPERATOR_PROJECT_ID}" \
    -v operator_blocks="${VECTOR_OPERATOR_BLOCK_HARD_LIMIT_KIB}" \
    -v operator_inodes="${VECTOR_OPERATOR_INODE_HARD_LIMIT}" \
    -v cache_id="#${VECTOR_CACHE_PROJECT_ID}" \
    -v cache_blocks="${VECTOR_CACHE_BLOCK_HARD_LIMIT_KIB}" \
    -v cache_inodes="${VECTOR_CACHE_INODE_HARD_LIMIT}" '
      $1 == operator_id {
        operator_found = 1
        if ($6 != operator_blocks || $10 != operator_inodes) exit 1
      }
      $1 == cache_id {
        cache_found = 1
        if ($6 != cache_blocks || $10 != cache_inodes) exit 1
      }
      END { if (!operator_found || !cache_found) exit 1 }
    '

quota_state_tmp="$(mktemp "${quota_state_file}.XXXXXX")"
trap 'rm -f -- "${quota_state_tmp}"' EXIT
printf '%s\n' "${quota_state}" >"${quota_state_tmp}"
chmod 0600 "${quota_state_tmp}"
mv -f -- "${quota_state_tmp}" "${quota_state_file}"
trap - EXIT
