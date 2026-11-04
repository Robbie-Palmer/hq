#!/usr/bin/env bash
set -euo pipefail

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

cat >"$work_dir/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail

url="${*: -1}"
case "$url" in
  */domains/managed)
    printf '{"success":true,"result":{"enabled":%s}}' "${MOCK_MANAGED_PUBLIC:-false}"
    ;;
  */domains/custom)
    printf '{"success":true,"result":{"domains":[]}}'
    ;;
  *.r2.cloudflarestorage.com/*)
    printf '403'
    ;;
  *)
    echo "Unexpected URL" >&2
    exit 1
    ;;
esac
MOCK_CURL
chmod +x "$work_dir/curl"

output="$(
  PATH="$work_dir:$PATH" \
    CLOUDFLARE_ACCOUNT_ID="fixture-account" \
    CLOUDFLARE_R2_AUDIT_API_TOKEN="fixture-token" \
    bash "$(dirname "$0")/check-private-access.sh"
)"
[[ "$output" == *"Public R2 domains are disabled"* ]]
[[ "$output" != *"fixture-token"* ]]

if PATH="$work_dir:$PATH" \
  CLOUDFLARE_ACCOUNT_ID="fixture-account" \
  CLOUDFLARE_R2_AUDIT_API_TOKEN="fixture-token" \
  MOCK_MANAGED_PUBLIC=true \
  bash "$(dirname "$0")/check-private-access.sh" >/dev/null 2>&1; then
  echo "Expected public managed-domain access to fail." >&2
  exit 1
fi
