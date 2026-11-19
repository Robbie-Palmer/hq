#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
cd "$project_root"
source versions.env
export PATH="$repository_root/infra/oci-registry-spike/.cache/bin:$PATH"

required=(R2_ENDPOINT R2_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "$variable is required for the live R2 spike" >&2
    exit 2
  fi
done
if [[ ! "$R2_ENDPOINT" =~ ^https://[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com/?$ ]]; then
  echo "R2_ENDPOINT must be a canonical Cloudflare R2 S3 endpoint" >&2
  exit 2
fi
if [[ ! "$R2_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "R2_BUCKET must be a valid R2 bucket name" >&2
  exit 2
fi
if [[ "${1:-}" == "--preflight" ]]; then
  echo "Live R2 inputs accepted without making requests or persisting credentials."
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Unknown argument: $1" >&2
  exit 2
fi
for command in curl docker helm jq openssl oras sha256sum; do
  command -v "$command" >/dev/null || {
    echo "$command is required" >&2
    exit 2
  }
done

run_root="$project_root/.artifacts/run"
state_root="$project_root/.state"
fixture_root="$run_root/fixtures"
results_file="$run_root/results.ndjson"
request_log="$run_root/direct-r2-request-classes.log"
container_name=oci-r2-artifact-spike-zot
scrub_container_name=oci-r2-artifact-spike-scrub
registry_endpoint="localhost:$ZOT_PORT"
registry_url="http://$registry_endpoint" # NOSONAR: loopback-only disposable registry.
bucket="$R2_BUCKET"
registry_username=spike
registry_password="$(openssl rand -hex 24)"
docker_run_label="hq.oci-r2-canary.run=$(openssl rand -hex 8)"

[[ "$run_root" == "$project_root/.artifacts/run" ]]
rm -rf "$run_root"
rm -rf "$state_root/auth" "$state_root/config" "$state_root/helm" "$state_root/oras"
mkdir -p "$run_root/logs" "$fixture_root" "$state_root/auth" "$state_root/config" "$state_root/helm" "$state_root/oras"
: > "$results_file"
: > "$request_log"

r2() {
  if [[ "${R2_COUNT_REQUEST:-1}" -eq 1 ]]; then
    case "$1:$2" in
      s3api:delete-*|s3api:abort-*) ;;
      s3api:head-*|s3api:get-*) printf 'B\n' >> "$request_log" ;;
      s3:rm) printf 'A\n' >> "$request_log" ;;
      *) printf 'A\n' >> "$request_log" ;;
    esac
  fi
  docker run --rm \
    --label "$docker_run_label" \
    --env AWS_ACCESS_KEY_ID \
    --env AWS_SECRET_ACCESS_KEY \
    --env AWS_SESSION_TOKEN \
    --env AWS_DEFAULT_REGION=auto \
    --env AWS_EC2_METADATA_DISABLED=true \
    --volume "$run_root:/work" \
    --workdir /work \
    --entrypoint aws \
    "$AWS_CLI_IMAGE" \
    --endpoint-url "$R2_ENDPOINT" --region auto "$@"
}

record() {
  local requirement="$1"
  local evidence="$2"
  jq -cn --arg requirement "$requirement" --arg evidence "$evidence" \
    '{requirement: $requirement, status: "pass", evidence: $evidence}' >> "$results_file"
}

render_config() {
  local destination="$1"
  local gc="$2"
  jq \
    --arg endpoint "${R2_ENDPOINT%/}" \
    --arg bucket "$bucket" \
    --argjson gc "$gc" \
    '.storage.storageDriver.regionendpoint = $endpoint |
     .storage.storageDriver.bucket = $bucket |
     .storage.gc = $gc |
     if $gc then .storage.gcDelay = "2s" | .storage.gcInterval = "3s"
     else del(.storage.gcDelay, .storage.gcInterval) end' \
    config/zot.json > "$destination"
  chmod 0444 "$destination"
}

start_zot() {
  local image="$1"
  local config="$2"
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  docker run --detach --rm \
    --name "$container_name" \
    --user 65532:65532 \
    --publish "127.0.0.1:$ZOT_PORT:5000" \
    --env AWS_ACCESS_KEY_ID \
    --env AWS_SECRET_ACCESS_KEY \
    --env AWS_SESSION_TOKEN \
    --volume "$config:/etc/zot/config.json:ro" \
    --volume "$state_root/auth/htpasswd:/etc/zot/registry-htpasswd:ro" \
    "$image" serve /etc/zot/config.json >/dev/null
  local status=000
  for _ in $(seq 1 60); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --user "$registry_username:$registry_password" "$registry_url/v2/" || true)"
    [[ "$status" == 200 ]] && return 0
    sleep 1
  done
  docker logs "$container_name" >&2 || true
  echo "zot did not become ready, last HTTP status was $status" >&2
  return 1
}

oras_auth=(--plain-http --registry-config "$state_root/oras/config.json")

blob_key_for() {
  local digest_hex="$1"
  r2 s3api list-objects-v2 --bucket "$bucket" --output json \
    | jq -r --arg digest "$digest_hex" '.Contents[]?.Key | select(contains($digest))' \
    | head -1
}

emergency_cleanup() {
  if ! bash scripts/stop-consumer-containers.sh; then
    echo "Canary container cleanup could not be verified" >&2
  fi
  unset registry_password
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  rm -rf "$state_root/auth" "$state_root/helm" "$state_root/oras"
}
trap emergency_cleanup EXIT

invalid_secret=invalid
if R2_COUNT_REQUEST=0 AWS_SECRET_ACCESS_KEY=${invalid_secret} \
  r2 s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  echo "R2 accepted an invalid secret" >&2
  exit 1
fi
r2 s3api head-bucket --bucket "$bucket" >/dev/null

docker run --rm "$HTTPD_IMAGE" htpasswd -nbB "$registry_username" "$registry_password" > "$state_root/auth/htpasswd"
chmod 0444 "$state_root/auth/htpasswd"
render_config "$state_root/config/zot.json" false
render_config "$state_root/config/zot-gc.json" true
start_zot "$ZOT_PREVIOUS_IMAGE" "$state_root/config/zot.json"

[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$registry_url/v2/")" == 401 ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --user "$registry_username:wrong" "$registry_url/v2/")" == 401 ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --user "$registry_username:$registry_password" "$registry_url/v2/")" == 200 ]]
record authentication "The temporary R2 session rejected an invalid secret; zot rejected missing and invalid registry credentials"

printf '%s' "$registry_password" | oras login "${oras_auth[@]}" \
  --username "$registry_username" --password-stdin "$registry_endpoint"

mkdir -p "$fixture_root/upgrade/pull"
printf 'created with the previous zot version\n' > "$fixture_root/upgrade/payload.txt"
(cd "$fixture_root/upgrade" && oras push "${oras_auth[@]}" \
  --artifact-type application/vnd.example.upgrade.v1 \
  "$registry_endpoint/spike/upgrade:previous" payload.txt:text/plain)
docker rm --force "$container_name" >/dev/null
start_zot "$ZOT_IMAGE" "$state_root/config/zot.json"
oras pull "${oras_auth[@]}" --output "$fixture_root/upgrade/pull" \
  "$registry_endpoint/spike/upgrade:previous"
cmp "$fixture_root/upgrade/payload.txt" "$fixture_root/upgrade/pull/payload.txt"
record upgrade "zot current read an artifact written by the pinned previous version"

mkdir -p "$fixture_root/direct"
printf 'conditional write A\n' > "$fixture_root/direct/a.txt"
printf 'conditional write B\n' > "$fixture_root/direct/b.txt"
assert_precondition_failure() {
  local error_file="$1"
  if ! grep -Eq '^An error occurred \(PreconditionFailed\) when calling the PutObject operation:' "$error_file"; then
    cat "$error_file" >&2
    echo "Conditional write failed without the expected 412 PreconditionFailed response" >&2
    return 1
  fi
}
r2 s3api put-object --bucket "$bucket" --key direct/conditional \
  --body /work/fixtures/direct/a.txt --if-none-match '*' >/dev/null
sequential_error="$run_root/logs/conditional-sequential.log"
if r2 s3api put-object --bucket "$bucket" --key direct/conditional \
  --body /work/fixtures/direct/b.txt --if-none-match '*' >/dev/null 2>"$sequential_error"; then
  echo "A repeated If-None-Match write succeeded" >&2
  exit 1
fi
assert_precondition_failure "$sequential_error"
set +e
concurrent_error_a="$run_root/logs/conditional-concurrent-a.log"
concurrent_error_b="$run_root/logs/conditional-concurrent-b.log"
r2 s3api put-object --bucket "$bucket" --key direct/concurrent \
  --body /work/fixtures/direct/a.txt --if-none-match '*' >/dev/null 2>"$concurrent_error_a" &
pid_a=$!
r2 s3api put-object --bucket "$bucket" --key direct/concurrent \
  --body /work/fixtures/direct/b.txt --if-none-match '*' >/dev/null 2>"$concurrent_error_b" &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
[[ "$status_a" -eq 0 && "$status_b" -ne 0 || "$status_a" -ne 0 && "$status_b" -eq 0 ]]
if [[ "$status_a" -ne 0 ]]; then
  assert_precondition_failure "$concurrent_error_a"
else
  assert_precondition_failure "$concurrent_error_b"
fi
record conditional-and-concurrent-writes "R2 returned one atomic winner for both sequential and concurrent If-None-Match writes"

dd if=/dev/zero of="$fixture_root/direct/part-1.bin" bs=1M count=5 status=none
printf 'multipart-tail' > "$fixture_root/direct/part-2.bin"
upload_id="$(r2 s3api create-multipart-upload --bucket "$bucket" --key direct/multipart.bin | jq -r .UploadId)"
etag_1="$(r2 s3api upload-part --bucket "$bucket" --key direct/multipart.bin \
  --part-number 1 --upload-id "$upload_id" --body /work/fixtures/direct/part-1.bin | jq -r .ETag)"
etag_2="$(r2 s3api upload-part --bucket "$bucket" --key direct/multipart.bin \
  --part-number 2 --upload-id "$upload_id" --body /work/fixtures/direct/part-2.bin | jq -r .ETag)"
jq -n --arg e1 "$etag_1" --arg e2 "$etag_2" \
  '{Parts: [{ETag: $e1, PartNumber: 1}, {ETag: $e2, PartNumber: 2}]}' \
  > "$fixture_root/direct/complete.json"
r2 s3api complete-multipart-upload --bucket "$bucket" --key direct/multipart.bin \
  --upload-id "$upload_id" --multipart-upload file:///work/fixtures/direct/complete.json >/dev/null
r2 s3api get-object --bucket "$bucket" --key direct/multipart.bin \
  --range bytes=5242880-5242893 /work/fixtures/direct/range.bin >/dev/null
cmp "$fixture_root/direct/part-2.bin" "$fixture_root/direct/range.bin"
record multipart-and-range-reads "A two-part upload completed and a byte-range read returned the exact tail"

mkdir -p "$fixture_root/release" "$fixture_root/model" "$fixture_root/chart/pull" "$fixture_root/export"
printf 'bounded release bundle\n' > "$fixture_root/release/bundle.txt"
dd if=/dev/zero of="$fixture_root/model/model.bin" bs=1M count=16 status=none
(cd "$fixture_root/release" && oras push "${oras_auth[@]}" \
  --artifact-type application/vnd.example.release-bundle.v1 \
  "$registry_endpoint/spike/release:v1" bundle.txt:application/octet-stream)
(cd "$fixture_root/model" && oras push "${oras_auth[@]}" \
  --artifact-type application/vnd.cncf.model.file.v1 \
  "$registry_endpoint/spike/model:v1" model.bin:application/octet-stream)
mkdir -p "$fixture_root/model/pull"
oras pull "${oras_auth[@]}" --output "$fixture_root/model/pull" \
  "$registry_endpoint/spike/model:v1"
cmp "$fixture_root/model/model.bin" "$fixture_root/model/pull/model.bin"
helm package fixtures/chart --destination "$fixture_root/chart" >/dev/null
export HELM_REGISTRY_CONFIG="$state_root/helm/config.json"
printf '%s' "$registry_password" | helm registry login "$registry_endpoint" \
  --username "$registry_username" --password-stdin --plain-http
helm push "$fixture_root/chart/oci-r2-spike-0.1.0.tgz" \
  "oci://$registry_endpoint/spike" --plain-http >/dev/null
helm pull "oci://$registry_endpoint/spike/oci-r2-spike" --version 0.1.0 \
  --plain-http --destination "$fixture_root/chart/pull"
cmp "$fixture_root/chart/oci-r2-spike-0.1.0.tgz" "$fixture_root/chart/pull/oci-r2-spike-0.1.0.tgz"
printf '{"spdxVersion":"SPDX-2.3","name":"r2-spike"}\n' > "$fixture_root/release/sbom.json"
release_digest="$(oras resolve "${oras_auth[@]}" "$registry_endpoint/spike/release:v1")"
(cd "$fixture_root/release" && oras attach "${oras_auth[@]}" \
  --artifact-type application/spdx+json \
  "$registry_endpoint/spike/release@$release_digest" \
  "sbom.json:application/spdx+json")
discover="$(oras discover "${oras_auth[@]}" --format json \
  "$registry_endpoint/spike/release@$release_digest")"
[[ "$(jq '.referrers | length' <<<"$discover")" -ge 1 ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --user "$registry_username:$registry_password" \
  "$registry_url/v2/spike/release/referrers/$release_digest")" == 200 ]]
record referrers-and-artifacts "ORAS release and model artifacts, Helm, and a native OCI 1.1 SBOM referrer round-tripped"

objects="$(r2 s3api list-objects-v2 --bucket "$bucket" --output json)"
[[ "$(jq '.KeyCount' <<<"$objects")" -gt 0 ]]
[[ "$(jq '[.Contents[].Size] | add' <<<"$objects")" -gt 16777216 ]]
record object-visibility "Registry objects were immediately visible through the R2 S3 API"

oras cp --from-plain-http --from-registry-config "$state_root/oras/config.json" \
  --to-oci-layout "$registry_endpoint/spike/release:v1" "$fixture_root/export/layout:v1"
oras manifest fetch --oci-layout "$fixture_root/export/layout:v1" \
  | jq --exit-status '.artifactType == "application/vnd.example.release-bundle.v1"' >/dev/null
record export "ORAS copied the R2-backed artifact into a portable OCI image layout"

metrics="$(curl --fail --silent "$registry_url/metrics")"
[[ "$(wc -l <<<"$metrics")" -gt 10 ]]
grep -Eq '(^go_|zot_)' <<<"$metrics"
record metrics "zot exposed Prometheus metrics while using R2"

mkdir -p "$fixture_root/recovery/pull"
printf 'recoverable R2 payload\n' > "$fixture_root/recovery/payload.txt"
recovery_hex="$(sha256sum "$fixture_root/recovery/payload.txt" | cut -d' ' -f1)"
(cd "$fixture_root/recovery" && oras push "${oras_auth[@]}" \
  --artifact-type application/vnd.example.recovery.v1 \
  "$registry_endpoint/spike/recovery:v1" payload.txt:text/plain)
recovery_key="$(blob_key_for "$recovery_hex")"
[[ -n "$recovery_key" ]]
docker run --rm \
  --name "$scrub_container_name" \
  --label "$docker_run_label" \
  --user 65532:65532 \
  --env AWS_ACCESS_KEY_ID \
  --env AWS_SECRET_ACCESS_KEY \
  --env AWS_SESSION_TOKEN \
  --volume "$state_root/config/zot.json:/etc/zot/config.json:ro" \
  --volume "$state_root/auth/htpasswd:/etc/zot/registry-htpasswd:ro" \
  "$ZOT_IMAGE" scrub /etc/zot/config.json > "$run_root/logs/scrub.log" 2>&1
r2 s3api get-object --bucket "$bucket" --key "$recovery_key" \
  /work/fixtures/recovery/object.backup >/dev/null
r2 s3api delete-object --bucket "$bucket" --key "$recovery_key" >/dev/null
if oras pull "${oras_auth[@]}" --output "$fixture_root/recovery/pull" \
  "$registry_endpoint/spike/recovery:v1" >/dev/null 2>&1; then
  echo "Pull succeeded after deleting a required R2 object" >&2
  exit 1
fi
r2 s3api put-object --bucket "$bucket" --key "$recovery_key" \
  --body /work/fixtures/recovery/object.backup >/dev/null
oras pull "${oras_auth[@]}" --output "$fixture_root/recovery/pull" \
  "$registry_endpoint/spike/recovery:v1" >/dev/null
cmp "$fixture_root/recovery/payload.txt" "$fixture_root/recovery/pull/payload.txt"
record scrub-and-recovery "zot scrub completed; exact-object loss broke pulls and restoring the object recovered them"

mkdir -p "$fixture_root/gc"
printf 'unique R2 garbage collection payload\n' > "$fixture_root/gc/payload.txt"
gc_hex="$(sha256sum "$fixture_root/gc/payload.txt" | cut -d' ' -f1)"
(cd "$fixture_root/gc" && oras push "${oras_auth[@]}" \
  --artifact-type application/vnd.example.gc.v1 \
  "$registry_endpoint/spike/gc:delete-me" payload.txt:text/plain)
gc_digest="$(oras resolve "${oras_auth[@]}" "$registry_endpoint/spike/gc:delete-me")"
gc_key="$(blob_key_for "$gc_hex")"
[[ -n "$gc_key" ]]
oras manifest delete "${oras_auth[@]}" --force "$registry_endpoint/spike/gc@$gc_digest"
start_zot "$ZOT_IMAGE" "$state_root/config/zot-gc.json"
for _ in $(seq 1 30); do
  gc_error="$run_root/logs/gc-head-object.log"
  if ! r2 s3api head-object --bucket "$bucket" --key "$gc_key" >/dev/null 2>"$gc_error"; then
    grep -Eqi '(404|NoSuchKey|Not Found)' "$gc_error"
    break
  fi
  sleep 1
done
if r2 s3api head-object --bucket "$bucket" --key "$gc_key" >/dev/null 2>"$gc_error"; then
  echo "zot garbage collection left the unreferenced R2 blob" >&2
  exit 1
fi
grep -Eqi '(404|NoSuchKey|Not Found)' "$gc_error"
start_zot "$ZOT_IMAGE" "$state_root/config/zot.json"
record garbage-collection "A dedicated aggressive-GC run removed an unreferenced R2 blob"

final_objects="$(r2 s3api list-objects-v2 --bucket "$bucket" --output json)"
object_count="$(jq '.KeyCount' <<<"$final_objects")"
stored_bytes="$(jq '[.Contents[]?.Size] | add // 0' <<<"$final_objects")"
storage_gb_month="$(jq -n --argjson bytes "$stored_bytes" '$bytes / 1000000000')"
storage_monthly_cost="$(jq -n --argjson gb "$storage_gb_month" '$gb * 0.015')"

docker rm --force "$container_name" >/dev/null
direct_class_a="$(grep -c '^A$' "$request_log")"
direct_class_b="$(grep -c '^B$' "$request_log")"
direct_request_cost="$(jq -n --argjson a "$direct_class_a" --argjson b "$direct_class_b" \
  '$a * 4.50 / 1000000 + $b * 0.36 / 1000000')"

jq -n \
  --argjson results "$(jq -s . "$results_file")" \
  --argjson objectCount "$object_count" \
  --argjson storedBytes "$stored_bytes" \
  --argjson classA "$direct_class_a" \
  --argjson classB "$direct_class_b" \
  --argjson storageMonthlyCost "$storage_monthly_cost" \
  --argjson directRequestCost "$direct_request_cost" \
  '{
    results: $results,
    measurements: {
      beforeTeardown: {objectCount: $objectCount, storedBytes: $storedBytes},
      cost: {
        currency: "USD",
        standardStorageMonthlyAtObservedBytes: $storageMonthlyCost,
        directlyIssuedClassARequests: $classA,
        directlyIssuedClassBRequests: $classB,
        directRequestCost: $directRequestCost,
        registryInternalRequestCost: "not observable with S3 credentials; use R2 account analytics for billing reconciliation"
      }
    }
  }' > "$run_root/consumer-evidence.json"

echo "Live R2 consumer checks passed; the broker now owns teardown."
