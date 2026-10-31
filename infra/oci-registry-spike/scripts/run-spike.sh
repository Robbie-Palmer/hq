#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
cd "$project_root"
source versions.env
export PATH="$project_root/.cache/bin:$PATH"

run_root="$project_root/.artifacts/run"
logs_dir="$run_root/logs"
results_file="$run_root/results.ndjson"
[[ "$run_root" == "$project_root/.artifacts/run" ]]
rm -rf "$run_root"
mkdir -p "$logs_dir"
: > "$results_file"

finish() {
  if [[ "${KEEP_SPIKE_STACK:-0}" != "1" ]]; then
    bash scripts/teardown.sh >/dev/null 2>&1 || true
  fi
}
trap finish EXIT

bash scripts/teardown.sh >/dev/null 2>&1 || true
bash scripts/setup.sh
source .state/auth.env

resource_file="$run_root/resources.json"
jq -n \
  --argjson zotImageBytes "$(docker image inspect "$ZOT_RUNTIME_IMAGE" --format '{{.Size}}')" \
  --argjson distributionImageBytes "$(docker image inspect "$DISTRIBUTION_RUNTIME_IMAGE" --format '{{.Size}}')" \
  '{measurement: "uncompressed local runtime image size before the test cases", zot: {imageBytes: $zotImageBytes}, distribution: {imageBytes: $distributionImageBytes}}' \
  > "$resource_file"

export DOCKER_CONFIG="$project_root/.state/docker"
export HELM_CONFIG_HOME="$project_root/.state/helm/config"
export HELM_CACHE_HOME="$project_root/.state/helm/cache"
export HELM_DATA_HOME="$project_root/.state/helm/data"
export COSIGN_PASSWORD="$(openssl rand -hex 24)"
mkdir -p "$DOCKER_CONFIG" "$HELM_CONFIG_HOME" "$HELM_CACHE_HOME" "$HELM_DATA_HOME"
for registry_endpoint in "localhost:${ZOT_PORT:-5101}" "localhost:${DISTRIBUTION_PORT:-5102}"; do
  printf '%s' "$REGISTRY_PASSWORD" | oras login --plain-http \
    --username "$REGISTRY_USERNAME" --password-stdin \
    --registry-config "$DOCKER_CONFIG/config.json" "$registry_endpoint"
done

record() {
  local implementation="$1"
  local requirement="$2"
  local status="$3"
  local evidence="$4"
  jq -cn \
    --arg implementation "$implementation" \
    --arg requirement "$requirement" \
    --arg status "$status" \
    --arg evidence "$evidence" \
    '{implementation: $implementation, requirement: $requirement, status: $status, evidence: $evidence}' \
    >> "$results_file"
}

run_case() {
  local implementation="$1"
  local requirement="$2"
  local function_name="$3"
  local log="$logs_dir/${implementation}-${requirement}.log"
  echo "[$implementation] $requirement"
  if (set -e; "$function_name" "$implementation") >"$log" 2>&1; then
    record "$implementation" "$requirement" pass "logs/${implementation}-${requirement}.log"
    return 0
  fi
  record "$implementation" "$requirement" fail "logs/${implementation}-${requirement}.log"
  return 0
}

endpoint_for() {
  local implementation="$1"
  if [[ "$implementation" == "zot" ]]; then
    printf 'localhost:%s' "${ZOT_PORT:-5101}"
  else
    printf 'localhost:%s' "${DISTRIBUTION_PORT:-5102}"
  fi
}

registry_url_for() {
  local implementation="$1"
  # Compose binds these disposable registries to loopback, and this suite intentionally tests with TLS disabled.
  printf 'http://%s' "$(endpoint_for "$implementation")" # NOSONAR
}

bucket_for() {
  local implementation="$1"
  if [[ "$implementation" == "zot" ]]; then
    printf 'zot-registry'
  else
    printf 'distribution-registry'
  fi
}

service_for() {
  local implementation="$1"
  printf '%s' "$implementation"
}

oras_args() {
  ORAS_AUTH_ARGS=(--plain-http --registry-config "$DOCKER_CONFIG/config.json")
}

test_authentication() {
  local registry_url
  registry_url="$(registry_url_for "$1")"
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$registry_url/v2/")" == "401" ]]
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --user "$REGISTRY_USERNAME:wrong" "$registry_url/v2/")" == "401" ]]
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --user "$REGISTRY_USERNAME:$REGISTRY_PASSWORD" "$registry_url/v2/")" == "200" ]]
}

test_conformance() {
  local implementation="$1"
  local endpoint container_id exit_code output_dir
  endpoint="$(endpoint_for "$implementation")"
  output_dir="$run_root/conformance/$implementation"
  mkdir -p "$output_dir"
  container_id="$(docker create \
    --network host \
    --env "OCI_REGISTRY=$endpoint" \
    --env OCI_TLS=disabled \
    --env "OCI_REPO1=conformance/$implementation/primary" \
    --env "OCI_REPO2=conformance/$implementation/crossmount" \
    --env "OCI_USERNAME=$REGISTRY_USERNAME" \
    --env "OCI_PASSWORD=$REGISTRY_PASSWORD" \
    --env OCI_VERSION=1.1 \
    --env OCI_RESULTS_DIR=/results \
    "oci-registry-spike-conformance:$CONFORMANCE_COMMIT")"
  docker start --attach "$container_id"
  exit_code="$(docker inspect "$container_id" --format '{{.State.ExitCode}}')"
  docker cp "$container_id:/results/." "$output_dir"
  docker rm "$container_id" >/dev/null
  [[ "$exit_code" == "0" ]]
}

test_oras_export() {
  local implementation="$1"
  local endpoint work_dir reference layout
  endpoint="$(endpoint_for "$implementation")"
  work_dir="$run_root/fixtures/$implementation/oras"
  reference="$endpoint/spike/$implementation/oras:v1"
  layout="$work_dir/layout"
  mkdir -p "$work_dir/export"
  printf 'bounded ORAS artifact for %s\n' "$implementation" > "$work_dir/payload.txt"
  oras_args
  (cd "$work_dir" && oras push "${ORAS_AUTH_ARGS[@]}" \
    --artifact-type application/vnd.example.spike.v1 "$reference" payload.txt:text/plain)
  oras pull "${ORAS_AUTH_ARGS[@]}" --output "$work_dir/export" "$reference"
  cmp "$work_dir/payload.txt" "$work_dir/export/payload.txt"
  oras cp \
    --from-plain-http \
    --from-registry-config "$DOCKER_CONFIG/config.json" \
    --to-oci-layout \
    "$reference" "$layout:v1"
  oras manifest fetch --oci-layout "$layout:v1" | jq --exit-status \
    '.artifactType == "application/vnd.example.spike.v1"' >/dev/null
}

test_docker_client() {
  local implementation="$1"
  local endpoint reference
  endpoint="$(endpoint_for "$implementation")"
  reference="$endpoint/spike/$implementation/container:single"
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$endpoint" --username "$REGISTRY_USERNAME" --password-stdin
  docker build --provenance=false --sbom=false --tag "$reference" fixtures/container
  docker push "$reference"
  docker image rm "$reference" >/dev/null
  docker pull "$reference"
}

test_multi_architecture() {
  local implementation="$1"
  local endpoint reference manifest
  endpoint="$(endpoint_for "$implementation")"
  reference="$endpoint/spike/$implementation/container:multi"
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --provenance=false \
    --sbom=false \
    --push \
    --tag "$reference" \
    fixtures/container
  manifest="$(docker buildx imagetools inspect --raw "$reference")"
  [[ "$(jq '[.manifests[].platform | select(.os == "linux" and (.architecture == "amd64" or .architecture == "arm64"))] | length' <<<"$manifest")" == "2" ]]
}

test_helm() {
  local implementation="$1"
  local endpoint chart_dir package
  endpoint="$(endpoint_for "$implementation")"
  chart_dir="$run_root/fixtures/$implementation/helm"
  mkdir -p "$chart_dir/pull"
  printf '%s' "$REGISTRY_PASSWORD" | helm registry login "$endpoint" \
    --username "$REGISTRY_USERNAME" --password-stdin --plain-http
  helm package fixtures/chart --destination "$chart_dir"
  package="$chart_dir/oci-registry-spike-0.1.0.tgz"
  helm push "$package" "oci://$endpoint/spike/$implementation" --plain-http
  helm pull "oci://$endpoint/spike/$implementation/oci-registry-spike" \
    --version 0.1.0 --plain-http --destination "$chart_dir/pull"
  cmp "$package" "$chart_dir/pull/oci-registry-spike-0.1.0.tgz"
}

test_kitops_model() {
  local implementation="$1"
  local endpoint fixture_dir kit_home reference source_hash unpacked_model
  endpoint="$(endpoint_for "$implementation")"
  fixture_dir="$run_root/fixtures/$implementation/model"
  kit_home="$project_root/.state/kit/$implementation"
  reference="$endpoint/spike/$implementation/model:v1"
  mkdir -p "$fixture_dir/source" "$fixture_dir/unpacked" "$kit_home"
  cp fixtures/model/Kitfile "$fixture_dir/source/Kitfile"
  dd if=/dev/zero of="$fixture_dir/source/model.bin" bs=1M count=16 status=none
  source_hash="$(sha256sum "$fixture_dir/source/model.bin" | cut -d' ' -f1)"
  printf '%s' "$REGISTRY_PASSWORD" | kit --config "$kit_home" login "$endpoint" \
    --username "$REGISTRY_USERNAME" --password-stdin --plain-http
  kit --config "$kit_home" pack "$fixture_dir/source" --tag "$reference" --push --plain-http --progress none
  kit --config "$kit_home" unpack "$reference" --dir "$fixture_dir/unpacked" --plain-http --progress none
  unpacked_model="$(find "$fixture_dir/unpacked" -type f -name model.bin -print -quit)"
  [[ -n "$unpacked_model" ]]
  [[ "$source_hash" == "$(sha256sum "$unpacked_model" | cut -d' ' -f1)" ]]
  [[ "$(stat -c '%s' "$unpacked_model")" == "16777216" ]]
}

test_signing_referrers() {
  local implementation="$1"
  local endpoint source_ref digest signed_ref key_prefix discover
  endpoint="$(endpoint_for "$implementation")"
  source_ref="$endpoint/spike/$implementation/oras:v1"
  oras_args
  digest="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$source_ref")"
  signed_ref="$endpoint/spike/$implementation/oras@$digest"
  key_prefix="$project_root/.state/cosign/$implementation"
  mkdir -p "$(dirname "$key_prefix")"
  cosign generate-key-pair --output-key-prefix "$key_prefix"
  cosign sign --yes --tlog-upload=false --use-signing-config=false --allow-insecure-registry \
    --key "$key_prefix.key" "$signed_ref"
  cosign verify --insecure-ignore-tlog --allow-insecure-registry \
    --key "$key_prefix.pub" "$signed_ref"
  discover="$(oras discover "${ORAS_AUTH_ARGS[@]}" --format json "$signed_ref")"
  [[ "$(jq '.referrers | length' <<<"$discover")" -ge 1 ]]
}

test_native_referrers() {
  local implementation="$1"
  local endpoint digest registry_url status
  endpoint="$(endpoint_for "$implementation")"
  registry_url="$(registry_url_for "$implementation")"
  oras_args
  digest="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$endpoint/spike/$implementation/oras:v1")"
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --user "$REGISTRY_USERNAME:$REGISTRY_PASSWORD" \
    "$registry_url/v2/spike/$implementation/oras/referrers/$digest")"
  [[ "$status" == "200" ]]
}

test_conditional_writes() {
  local implementation="$1"
  local bucket key
  bucket="$(bucket_for "$implementation")"
  key="conditional/$implementation"
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api put-object --bucket "$bucket" --key "$key" --body /etc/hosts --if-none-match '*' >/dev/null
  if docker compose --env-file versions.env exec -T localstack \
    awslocal s3api put-object --bucket "$bucket" --key "$key" --body /etc/hosts --if-none-match '*' >/dev/null 2>&1; then
    echo "The second If-None-Match write unexpectedly succeeded" >&2
    return 1
  fi
}

test_concurrent_writes() {
  local implementation="$1"
  local endpoint dir repository digest_a digest_b final_digest pid_a pid_b
  endpoint="$(endpoint_for "$implementation")"
  dir="$run_root/fixtures/$implementation/concurrent"
  repository="$endpoint/spike/$implementation/concurrent"
  mkdir -p "$dir"
  printf 'concurrent payload A\n' > "$dir/a.txt"
  printf 'concurrent payload B\n' > "$dir/b.txt"
  oras_args
  (cd "$dir" && oras push "${ORAS_AUTH_ARGS[@]}" "$repository:a" a.txt:text/plain)
  (cd "$dir" && oras push "${ORAS_AUTH_ARGS[@]}" "$repository:b" b.txt:text/plain)
  digest_a="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$repository:a")"
  digest_b="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$repository:b")"
  oras tag "${ORAS_AUTH_ARGS[@]}" "$repository@$digest_a" race &
  pid_a=$!
  oras tag "${ORAS_AUTH_ARGS[@]}" "$repository@$digest_b" race &
  pid_b=$!
  wait "$pid_a"
  wait "$pid_b"
  final_digest="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$repository:race")"
  [[ "$final_digest" == "$digest_a" || "$final_digest" == "$digest_b" ]]
}

blob_key_for() {
  local bucket="$1"
  local digest_hex="$2"
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api list-objects-v2 --bucket "$bucket" --query 'Contents[].Key' --output text \
    | tr '\t' '\n' | grep "$digest_hex" | head -1
}

test_garbage_collection() {
  local implementation="$1"
  local endpoint bucket dir reference digest manifest_digest key
  endpoint="$(endpoint_for "$implementation")"
  bucket="$(bucket_for "$implementation")"
  dir="$run_root/fixtures/$implementation/gc"
  reference="$endpoint/spike/$implementation/gc:delete-me"
  mkdir -p "$dir"
  printf 'unique garbage collection payload for %s\n' "$implementation" > "$dir/gc.txt"
  digest="$(sha256sum "$dir/gc.txt" | cut -d' ' -f1)"
  oras_args
  (cd "$dir" && oras push "${ORAS_AUTH_ARGS[@]}" "$reference" gc.txt:text/plain)
  manifest_digest="$(oras resolve "${ORAS_AUTH_ARGS[@]}" "$reference")"
  key="$(blob_key_for "$bucket" "$digest")"
  [[ -n "$key" ]]
  oras manifest delete "${ORAS_AUTH_ARGS[@]}" --force "$endpoint/spike/$implementation/gc@$manifest_digest"
  if [[ "$implementation" == "zot" ]]; then
    docker compose --env-file versions.env stop zot
    docker build --file zot-gc.Dockerfile --build-arg "BASE_IMAGE=$ZOT_IMAGE" --tag "$ZOT_RUNTIME_IMAGE" .
    docker compose --env-file versions.env up --detach --force-recreate --wait zot
    sleep 8
    build_runtime_image zot "$ZOT_IMAGE"
    docker compose --env-file versions.env up --detach --force-recreate --wait zot
  else
    docker compose --env-file versions.env stop distribution
    docker compose --env-file versions.env run --rm --no-deps distribution \
      garbage-collect --delete-untagged /etc/distribution/config.yml
    docker compose --env-file versions.env up --detach --wait distribution
  fi
  if docker compose --env-file versions.env exec -T localstack \
    awslocal s3api head-object --bucket "$bucket" --key "$key" >/dev/null 2>&1; then
    echo "Unreferenced blob remains after garbage collection: $key" >&2
    return 1
  fi
}

test_scrub_recovery() {
  local implementation="$1"
  local endpoint bucket dir reference digest key backup_path
  endpoint="$(endpoint_for "$implementation")"
  bucket="$(bucket_for "$implementation")"
  dir="$run_root/fixtures/$implementation/recovery"
  reference="$endpoint/spike/$implementation/recovery:v1"
  backup_path="/tmp/$implementation-recovery-object"
  mkdir -p "$dir/pull"
  printf 'recoverable payload for %s\n' "$implementation" > "$dir/recovery.txt"
  digest="$(sha256sum "$dir/recovery.txt" | cut -d' ' -f1)"
  oras_args
  (cd "$dir" && oras push "${ORAS_AUTH_ARGS[@]}" "$reference" recovery.txt:text/plain)
  key="$(blob_key_for "$bucket" "$digest")"
  [[ -n "$key" ]]
  if [[ "$implementation" == "zot" ]]; then
    docker run --rm --network oci-registry-spike_default \
      --env AWS_ACCESS_KEY_ID=test --env AWS_SECRET_ACCESS_KEY=test \
      "$ZOT_RUNTIME_IMAGE" scrub /etc/zot/config.json
  else
    docker compose --env-file versions.env stop distribution
    docker compose --env-file versions.env run --rm --no-deps distribution \
      garbage-collect --dry-run /etc/distribution/config.yml
    docker compose --env-file versions.env up --detach --wait distribution
  fi
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api get-object --bucket "$bucket" --key "$key" "$backup_path" >/dev/null
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api delete-object --bucket "$bucket" --key "$key" >/dev/null
  if oras pull "${ORAS_AUTH_ARGS[@]}" --output "$dir/pull" "$reference" >/dev/null 2>&1; then
    echo "Pull unexpectedly succeeded with the layer removed" >&2
    return 1
  fi
  docker compose --env-file versions.env exec -T localstack \
    awslocal s3api put-object --bucket "$bucket" --key "$key" --body "$backup_path" >/dev/null
  oras pull "${ORAS_AUTH_ARGS[@]}" --output "$dir/pull" "$reference"
  cmp "$dir/recovery.txt" "$dir/pull/recovery.txt"
}

test_metrics() {
  local implementation="$1"
  local metrics
  if [[ "$implementation" == "zot" ]]; then
    metrics="$(curl --fail --silent http://localhost:${ZOT_PORT:-5101}/metrics)"
  else
    metrics="$(curl --fail --silent http://localhost:${DISTRIBUTION_DEBUG_PORT:-5103}/metrics)"
  fi
  [[ "$(wc -l <<<"$metrics")" -gt 10 ]]
  grep -Eq '(^go_|zot_|registry_)' <<<"$metrics"
}

build_runtime_image() {
  local implementation="$1"
  local base_image="$2"
  if [[ "$implementation" == "zot" ]]; then
    docker build --file zot.Dockerfile --build-arg "BASE_IMAGE=$base_image" --tag "$ZOT_RUNTIME_IMAGE" .
  else
    docker build --file distribution.Dockerfile --build-arg "BASE_IMAGE=$base_image" --tag "$DISTRIBUTION_RUNTIME_IMAGE" .
  fi
}

test_upgrade() {
  local implementation="$1"
  local endpoint bucket service previous current dir reference
  endpoint="$(endpoint_for "$implementation")"
  bucket="$(bucket_for "$implementation")"
  service="$(service_for "$implementation")"
  dir="$run_root/fixtures/$implementation/upgrade"
  reference="$endpoint/spike/$implementation/upgrade:from-previous"
  if [[ "$implementation" == "zot" ]]; then
    previous="$ZOT_PREVIOUS_IMAGE"
    current="$ZOT_IMAGE"
  else
    previous="$DISTRIBUTION_PREVIOUS_IMAGE"
    current="$DISTRIBUTION_IMAGE"
  fi
  mkdir -p "$dir/pull"
  printf 'upgrade payload for %s\n' "$implementation" > "$dir/upgrade.txt"
  docker compose --env-file versions.env stop "$service"
  docker compose --env-file versions.env exec -T localstack awslocal s3 rm "s3://$bucket" --recursive >/dev/null
  build_runtime_image "$implementation" "$previous"
  docker compose --env-file versions.env up --detach --force-recreate --wait "$service"
  oras_args
  (cd "$dir" && oras push "${ORAS_AUTH_ARGS[@]}" "$reference" upgrade.txt:text/plain)
  docker compose --env-file versions.env stop "$service"
  build_runtime_image "$implementation" "$current"
  docker compose --env-file versions.env up --detach --force-recreate --wait "$service"
  oras pull "${ORAS_AUTH_ARGS[@]}" --output "$dir/pull" "$reference"
  cmp "$dir/upgrade.txt" "$dir/pull/upgrade.txt"
}

for implementation in zot distribution; do
  run_case "$implementation" authentication test_authentication
  run_case "$implementation" distribution-conformance test_conformance
  run_case "$implementation" oras-export test_oras_export
  run_case "$implementation" docker-client test_docker_client
  run_case "$implementation" multi-architecture test_multi_architecture
  run_case "$implementation" helm test_helm
  run_case "$implementation" kitops-model test_kitops_model
  run_case "$implementation" signing-referrers test_signing_referrers
  run_case "$implementation" native-referrers-api test_native_referrers
  run_case "$implementation" conditional-writes test_conditional_writes
  run_case "$implementation" concurrent-writes test_concurrent_writes
  run_case "$implementation" garbage-collection test_garbage_collection
  run_case "$implementation" scrub-recovery test_scrub_recovery
  run_case "$implementation" metrics test_metrics
  run_case "$implementation" upgrade test_upgrade
done

jq -s \
  --arg revision "$(git -C "$repository_root" rev-parse HEAD)" \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile resources "$resource_file" \
  '{schemaVersion: 1, revision: $revision, generatedAt: $generatedAt, results: ., resources: $resources[0], liveR2: {status: "not_run"}}' \
  "$results_file" > "$run_root/scorecard.json"

failures="$(jq '[.results[] | select(.status == "fail")] | length' "$run_root/scorecard.json")"
echo "Scorecard: $run_root/scorecard.json"
echo "Failures: $failures"
jq --exit-status '
  [.results[] | select(.status == "fail") | {implementation, requirement}] == [
    {implementation: "distribution", requirement: "distribution-conformance"},
    {implementation: "distribution", requirement: "native-referrers-api"}
  ]
' "$run_root/scorecard.json" >/dev/null
