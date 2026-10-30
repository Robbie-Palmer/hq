#!/usr/bin/env bash
set -euo pipefail

required=(R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_PREFIX)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "$variable is required for the opt-in live R2 preflight" >&2
    exit 2
  fi
done

echo "Live R2 remains a separate, unrun check. It is not part of the local scorecard." >&2
echo "The supplied credentials were accepted into the process environment but were not printed or persisted." >&2
echo "This preflight does not mutate R2. A disposable bucket and deletion authority remain owner-gated." >&2
exit 3

