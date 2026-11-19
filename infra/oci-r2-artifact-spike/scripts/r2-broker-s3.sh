#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$project_root/versions.env"

operation="${1:-}"
bucket="${2:-}"
if [[ "$operation" != head && "$operation" != purge ]]; then
  echo "Pass head or purge as the R2 broker S3 operation" >&2
  exit 2
fi
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "R2 broker bucket name is invalid" >&2
  exit 2
fi
for variable in R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [[ -z "${!variable:-}" ]]; then
    echo "$variable is required by the R2 broker S3 helper" >&2
    exit 2
  fi
done

r2() {
  docker run --rm \
    --env AWS_ACCESS_KEY_ID \
    --env AWS_SECRET_ACCESS_KEY \
    --env AWS_SESSION_TOKEN \
    --env AWS_DEFAULT_REGION=auto \
    --env AWS_EC2_METADATA_DISABLED=true \
    --entrypoint aws \
    "$AWS_CLI_IMAGE" \
    --endpoint-url "$R2_ENDPOINT" --region auto "$@"
}

if [[ "$operation" == head ]]; then
  exec 3>&1
  r2 s3api head-bucket --bucket "$bucket" 2>&1 >&3
  exit
fi

error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
if ! r2 s3api head-bucket --bucket "$bucket" >/dev/null 2>"$error_file"; then
  if grep -Eqi '(404|NoSuchBucket|Not Found)' "$error_file"; then
    exit 0
  fi
  cat "$error_file" >&2
  exit 1
fi

uploads="$(r2 s3api list-multipart-uploads --bucket "$bucket" --output json)"
while IFS=$'\t' read -r key upload_id; do
  [[ -n "$key" && -n "$upload_id" ]] || continue
  r2 s3api abort-multipart-upload \
    --bucket "$bucket" --key "$key" --upload-id "$upload_id" >/dev/null
done < <(jq -r '.Uploads[]? | [.Key, .UploadId] | @tsv' <<<"$uploads")
r2 s3 rm "s3://$bucket" --recursive --only-show-errors

remaining_objects="$(r2 s3api list-objects-v2 --bucket "$bucket" --output json)"
remaining_uploads="$(r2 s3api list-multipart-uploads --bucket "$bucket" --output json)"
jq -e '.KeyCount == 0' >/dev/null <<<"$remaining_objects"
jq -e '(.Uploads // []) | length == 0' >/dev/null <<<"$remaining_uploads"
