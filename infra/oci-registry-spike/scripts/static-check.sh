#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
cd "$project_root"
source versions.env
mode="${1:?Pass format, lint, or test}"

case "$mode" in
  format)
    for config in config/zot.json config/zot-gc.json evidence/scorecard.json; do
      temporary=".$(basename "$config").formatted.tmp"
      jq --indent 2 . "$config" > "$temporary"
      cmp "$config" "$temporary"
      rm "$temporary"
    done
    git -C "$repository_root" diff --check -- infra/oci-registry-spike .mise.toml
    ;;
  lint)
    find scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
    jq --exit-status . config/zot.json config/zot-gc.json evidence/scorecard.json >/dev/null
    docker compose --env-file versions.env config --quiet
    ;;
  test)
    grep -Eq '^FROM scratch$' fixtures/container/Dockerfile
    grep -Eq '^CONFORMANCE_COMMIT=[0-9a-f]{40}$' versions.env
    if grep -Eqi '(password|secret)[[:space:]]*=[[:space:]]*[^$<{[:space:]]+' versions.env; then
      echo "versions.env must not contain credentials" >&2
      exit 1
    fi
    image_variables=(LOCALSTACK_IMAGE ZOT_IMAGE ZOT_PREVIOUS_IMAGE DISTRIBUTION_IMAGE DISTRIBUTION_PREVIOUS_IMAGE HTTPD_IMAGE CONFORMANCE_BUILDER_IMAGE)
    for variable in "${image_variables[@]}"; do
      value="${!variable}"
      [[ "$value" == *@sha256:* ]] || {
        echo "$variable is not digest-pinned" >&2
        exit 1
      }
    done
    jq --exit-status '
      .schemaVersion == 1 and
      (.implementations | length == 2) and
      ([.implementations[].id] | sort == ["distribution", "zot"])
    ' evidence/scorecard.json >/dev/null
    ;;
  *)
    echo "Unknown check mode: $mode" >&2
    exit 2
    ;;
esac

