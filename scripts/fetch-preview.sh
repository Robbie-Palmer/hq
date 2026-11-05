#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: mise run //:preview:fetch -- https://pr-<number>.<pages-host>/<path>" >&2
  exit 2
fi

preview_url="$1"
pages_host="${CLOUDFLARE_PAGES_HOST:-${CF_PAGES_HOST:-personal-site-bu5.pages.dev}}"
client_id="${CF_ACCESS_CLIENT_ID:-}"
client_secret="${CF_ACCESS_CLIENT_SECRET:-}"

: "${client_id:?CF_ACCESS_CLIENT_ID is required}"
: "${client_secret:?CF_ACCESS_CLIENT_SECRET is required}"

if [[ ! "$pages_host" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]] || \
  [[ "$pages_host" != *.* ]] || [[ "$pages_host" == *..* ]]; then
  echo "Refusing to send Access credentials: CLOUDFLARE_PAGES_HOST must be a lowercase hostname." >&2
  exit 2
fi

curl_version=$(curl --version | awk 'NR == 1 { print $2 }')
IFS=. read -r curl_major curl_minor _ <<<"$curl_version"
if [[ ! "$curl_major" =~ ^[0-9]+$ ]] || [[ ! "$curl_minor" =~ ^[0-9]+$ ]] || \
  ((curl_major < 7 || (curl_major == 7 && curl_minor < 55))); then
  echo "curl 7.55.0 or newer is required to pass Access headers through stdin." >&2
  exit 2
fi

case "$preview_url" in
  "https://"*/*) preview_host="${preview_url#https://}"; preview_host="${preview_host%%/*}" ;;
  "https://"*) preview_host="${preview_url#https://}" ;;
  *)
    echo "Refusing to send Access credentials: preview URL must use HTTPS." >&2
    exit 2
    ;;
esac

preview_label="${preview_host%%.*}"
if [[ ! "$preview_label" =~ ^pr-[1-9][0-9]*$ ]] || [[ "$preview_host" != "$preview_label.$pages_host" ]]; then
  echo "Refusing to send Access credentials to non-preview host: $preview_host" >&2
  exit 2
fi

# Make redirects an error so Access headers never leave the validated origin.
printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' "$client_id" "$client_secret" | \
  curl \
    --disable \
    --connect-timeout 10 \
    --fail-with-body \
    --header @- \
    --location \
    --max-redirs 0 \
    --max-time 30 \
    --proto '=https' \
    --silent \
    --show-error \
    --url "$preview_url"
