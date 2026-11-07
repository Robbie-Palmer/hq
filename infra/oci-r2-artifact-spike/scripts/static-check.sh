#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
cd "$project_root"
source versions.env
mode="${1:?Pass format, lint, test, or evidence}"

case "$mode" in
  format)
    for file in config/zot.json evidence/scorecard.json; do
      [[ -f "$file" ]] || continue
      temporary="$(mktemp)"
      jq --indent 2 . "$file" > "$temporary"
      cmp "$file" "$temporary"
      rm "$temporary"
    done
    git -C "$repository_root" diff --check -- infra/oci-r2-artifact-spike .mise.toml
    ;;
  lint)
    find scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
    jq --exit-status . config/zot.json >/dev/null
    if [[ -f evidence/scorecard.json ]]; then
      jq --exit-status . evidence/scorecard.json >/dev/null
    fi
    ;;
  test)
    if env -u R2_ENDPOINT -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY -u R2_BUCKET_PREFIX \
      bash scripts/run-live.sh --preflight >/dev/null 2>&1; then
      echo "Preflight accepted missing credentials" >&2
      exit 1
    fi
    R2_ENDPOINT=https://example.r2.cloudflarestorage.com \
      R2_ACCESS_KEY_ID=fixture-access-key \
      R2_SECRET_ACCESS_KEY=fixture-secret-key \
      R2_BUCKET_PREFIX=oci-r2-spike-test \
      bash scripts/run-live.sh --preflight | grep -Fq 'accepted without making requests'
    for image_variable in AWS_CLI_IMAGE HTTPD_IMAGE ZOT_IMAGE ZOT_PREVIOUS_IMAGE; do
      [[ "${!image_variable}" == *@sha256:* ]] || {
        echo "$image_variable is not digest-pinned" >&2
        exit 1
      }
    done
    if rg -n --hidden --glob '!scripts/static-check.sh' \
      '(R2_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY)[[:space:]]*=[[:space:]]*[^$<{[:space:]]+' .; then
      echo "A credential value appears to be committed" >&2
      exit 1
    fi
    jq --exit-status '
      .storage.storageDriver |
      .name == "s3" and .region == "auto" and .forcepathstyle == true and
      .secure == true and .v4auth == true
    ' config/zot.json >/dev/null
    ;;
  evidence)
    jq --exit-status '
      .schemaVersion == 1 and
      .ticket == "pep-oci-artifact-storage-spike" and
      .provider == "cloudflare-r2" and
      .implementation == "zot" and
      .credentialsPersisted == false and
      .teardown.bucketDeleted == true and
      ([.results[].status] | all(. == "pass")) and
      (.results | map(.requirement) | sort) == ([
        "authentication", "conditional-and-concurrent-writes", "export",
        "garbage-collection", "metrics", "multipart-and-range-reads",
        "object-visibility", "referrers-and-artifacts", "scrub-and-recovery",
        "teardown", "upgrade"
      ] | sort)
    ' evidence/scorecard.json >/dev/null
    if rg -n '([A-Z0-9]{20,}|r2\.cloudflarestorage\.com)' evidence; then
      echo "Evidence contains an account endpoint or credential-shaped value" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown check mode: $mode" >&2
    exit 2
    ;;
esac
