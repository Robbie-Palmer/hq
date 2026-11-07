#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
source versions.env

bucket="${R2_BUCKET:-}"
if [[ -z "$bucket" && -f .state/bucket ]]; then
  bucket="$(<.state/bucket)"
fi
if [[ -z "$bucket" ]]; then
  echo "R2_BUCKET or .state/bucket is required" >&2
  exit 2
fi
for variable in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [[ -z "${!variable:-}" ]]; then
    echo "$variable is required" >&2
    exit 2
  fi
done
export AWS_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
export AWS_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}

r2() {
  if [[ -n "${R2_REQUEST_LOG:-}" ]]; then
    case "$1:$2" in
      s3api:head-*|s3api:get-*|s3api:list-*) printf 'B\n' >> "$R2_REQUEST_LOG" ;;
      s3:rm) printf 'A\nB\n' >> "$R2_REQUEST_LOG" ;;
      *) printf 'A\n' >> "$R2_REQUEST_LOG" ;;
    esac
  fi
  docker run --rm \
    --env AWS_ACCESS_KEY_ID \
    --env AWS_SECRET_ACCESS_KEY \
    --env AWS_DEFAULT_REGION=auto \
    --env AWS_EC2_METADATA_DISABLED=true \
    --entrypoint aws \
    "$AWS_CLI_IMAGE" \
    --endpoint-url "$R2_ENDPOINT" --region auto "$@"
}

docker rm --force oci-r2-artifact-spike-zot >/dev/null 2>&1 || true
uploads="$(r2 s3api list-multipart-uploads --bucket "$bucket" --output json 2>/dev/null || printf '{"Uploads":[]}')"
while IFS=$'\t' read -r key upload_id; do
  [[ -n "$key" && -n "$upload_id" ]] || continue
  r2 s3api abort-multipart-upload --bucket "$bucket" --key "$key" --upload-id "$upload_id" >/dev/null
done < <(jq -r '.Uploads[]? | [.Key, .UploadId] | @tsv' <<<"$uploads")
r2 s3 rm "s3://$bucket" --recursive --only-show-errors
r2 s3api delete-bucket --bucket "$bucket"
if r2 s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  echo "Disposable bucket still exists after teardown" >&2
  exit 1
fi
rm -f .state/bucket
echo "Verified deletion of disposable R2 bucket $bucket"
