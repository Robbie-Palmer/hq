#!/usr/bin/env bash
set -euo pipefail

bucket=robbie-personal-archive-object-lock-lab-20261104
s3_endpoint=s3.eu-central-003.backblazeb2.com
prefix_root=object-lock-experiments
archive_id=robbie-vector-gp68hx-13vh-home-migration
b2_bin=${B2_BIN:-b2}
restic_bin=${RESTIC_BIN:-restic}

usage() {
  cat >&2 <<'EOF'
Usage:
  object-lock-experiment.sh start --idle-proof FILE
  object-lock-experiment.sh cleanup --prefix PREFIX --retain-until TIMESTAMP

Both commands read a bootstrap B2 credential from the private files
named by B2_ADMIN_KEY_ID_FILE and B2_ADMIN_APPLICATION_KEY_FILE.
The bootstrap credential is used only for read-only preflight plus creation and
revocation of a short-lived maintenance key.
EOF
  exit 2
}

fail() {
  echo "$1" >&2
  exit 1
}

require_secret_file() {
  local variable_name=$1
  local file=${!variable_name:-}
  [[ -n "${file}" ]] && [[ -r "${file}" ]] || fail "${variable_name} must name a readable private file"
}

validate_prefix() {
  local candidate=$1
  [[ "${candidate}" =~ ^${prefix_root}/[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}/restic$ ]] ||
    fail "the disposable repository prefix is invalid"
  [[ "${candidate}" != restic/* ]] || fail "the disposable prefix overlaps the production restic namespace"
  [[ "${candidate}" != *robbie-vector-gp68hx-13vh* ]] ||
    fail "the disposable prefix contains the production archive identity"
}

validate_idle_proof() {
  local proof_file=$1
  [[ -r "${proof_file}" ]] || fail "the archive idle proof is not readable"
  jq -e --arg archiveId "${archive_id}" '
    .schemaVersion == 1 and .archiveId == $archiveId and .idle == true and
    (.checkedAt | type == "string") and (.host | type == "string" and length > 0)
  ' "${proof_file}" >/dev/null || fail "the archive idle proof is invalid"
  local checked_epoch now
  checked_epoch=$(date -u -d "$(jq -r '.checkedAt' "${proof_file}")" +%s 2>/dev/null) ||
    fail "the archive idle proof timestamp is invalid"
  now=$(date +%s)
  (( checked_epoch <= now && now - checked_epoch <= 900 )) ||
    fail "the archive idle proof is older than 15 minutes"
}

require_secret_file B2_ADMIN_KEY_ID_FILE
require_secret_file B2_ADMIN_APPLICATION_KEY_FILE
for command in "${b2_bin}" jq date mktemp; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required"
done

runtime_directory=${XDG_RUNTIME_DIR:-/dev/shm}
[[ -d "${runtime_directory}" && -w "${runtime_directory}" ]] ||
  fail "a writable in-memory runtime directory is required"
work_directory=$(mktemp -d "${runtime_directory}/personal-archive-object-lock.XXXXXX")
chmod 0700 "${work_directory}"
export B2_ACCOUNT_INFO="${work_directory}/b2-account.sqlite"
bootstrap_key_id=$(<"${B2_ADMIN_KEY_ID_FILE}")
bootstrap_application_key=$(<"${B2_ADMIN_APPLICATION_KEY_FILE}")
[[ -n "${bootstrap_key_id}" && -n "${bootstrap_application_key}" ]] || fail "the bootstrap B2 credential is empty"

maintenance_key_id=
maintenance_application_key=
maintenance_key_name=
policy_key_id=
policy_application_key=
policy_key_name=
data_key_id=
data_application_key=
data_key_name=
default_enabled=false
bucket_created=false
delete_empty_bucket_on_exit=false

run_bootstrap() {
  B2_APPLICATION_KEY_ID="${bootstrap_key_id}" \
    B2_APPLICATION_KEY="${bootstrap_application_key}" \
    "${b2_bin}" "$@"
}

run_admin() {
  B2_APPLICATION_KEY_ID="${maintenance_key_id}" \
    B2_APPLICATION_KEY="${maintenance_application_key}" \
    "${b2_bin}" "$@"
}

run_policy() {
  B2_APPLICATION_KEY_ID="${policy_key_id}" \
    B2_APPLICATION_KEY="${policy_application_key}" \
    "${b2_bin}" "$@"
}

run_data() {
  B2_APPLICATION_KEY_ID="${data_key_id}" \
    B2_APPLICATION_KEY="${data_application_key}" \
    "${b2_bin}" "$@"
}

revoke_key() {
  local key_id=$1
  local runner=${2:-run_admin}
  [[ -z "${key_id}" ]] || "${runner}" key delete "${key_id}" >/dev/null
}

assert_key_revoked() {
  local key_name=$1
  local runner=${2:-run_admin}
  "${runner}" key list -l >"${work_directory}/keys-after-revoke.txt"
  ! awk -v name="${key_name}" '$2 == name { found = 1 } END { exit !found }' \
    "${work_directory}/keys-after-revoke.txt"
}

remove_default() {
  local removed=false
  if [[ -n "${policy_key_id}" ]]; then
    run_policy bucket update --default-retention-mode none "${bucket}" >/dev/null 2>&1 && removed=true
  fi
  if [[ "${removed}" != true ]]; then
    run_admin bucket update --default-retention-mode none "${bucket}" >/dev/null 2>&1 && removed=true
  fi
  [[ "${removed}" = true ]]
}

cleanup_secrets() {
  local exit_code=$?
  set +e
  if [[ "${default_enabled}" = true ]]; then
    if remove_default; then
      default_enabled=false
    else
      echo "failed to remove the temporary bucket default retention" >&2
      exit_code=1
    fi
  fi
  if ! revoke_key "${data_key_id}"; then
    echo "failed to revoke the temporary data key" >&2
    exit_code=1
  fi
  if ! revoke_key "${policy_key_id}"; then
    echo "failed to revoke the temporary policy key" >&2
    exit_code=1
  fi
  if [[ "${delete_empty_bucket_on_exit}" = true && "${bucket_created}" = true ]]; then
    if run_admin bucket delete "${bucket}" >/dev/null; then
      bucket_created=false
    else
      echo "failed to remove the empty experiment bucket" >&2
      exit_code=1
    fi
  fi
  if ! revoke_key "${maintenance_key_id}" run_bootstrap; then
    echo "failed to revoke the temporary maintenance key" >&2
    exit_code=1
  fi
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_PASSWORD_FILE \
    RESTIC_REPOSITORY RESTIC_CACHE_DIR
  bootstrap_key_id=
  bootstrap_application_key=
  maintenance_application_key=
  policy_application_key=
  data_application_key=
  rm -rf -- "${work_directory}"
  exit "${exit_code}"
}
trap cleanup_secrets EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

read_bucket() {
  local runner=${1:-run_admin}
  "${runner}" bucket get "${bucket}" >"${work_directory}/bucket.json"
  if ! jq -e --arg bucket "${bucket}" '
    .bucketName == $bucket and .bucketType == "allPrivate" and
    .fileLockConfiguration.isClientAuthorizedToRead == true and
    .fileLockConfiguration.value.isFileLockEnabled == true
  ' "${work_directory}/bucket.json" >/dev/null; then
    jq --arg bucket "${bucket}" '{
      exactName: (.bucketName == $bucket),
      private: (.bucketType == "allPrivate"),
      retentionReadable: (.fileLockConfiguration.isClientAuthorizedToRead == true),
      objectLockEnabled: (.fileLockConfiguration.value.isFileLockEnabled == true)
    }' "${work_directory}/bucket.json" >&2
    fail "the exact private Object Lock-capable bucket could not be verified"
  fi
}

read_new_unlocked_bucket() {
  run_bootstrap bucket get "${bucket}" >"${work_directory}/bucket.json"
  jq -e --arg bucket "${bucket}" '
    .bucketName == $bucket and .bucketType == "allPrivate" and
    ((.fileLockConfiguration.value.isFileLockEnabled // false) == false)
  ' "${work_directory}/bucket.json" >/dev/null ||
    fail "the new private experiment bucket could not be verified before enabling Object Lock"
}

assert_no_default_retention() {
  jq -e '
    .fileLockConfiguration.value.defaultRetention.mode == null and
    .fileLockConfiguration.value.defaultRetention.period == null
  ' "${work_directory}/bucket.json" >/dev/null ||
    fail "the bucket already has default retention; refusing to overwrite it"
}

assert_bucket_absent() {
  run_bootstrap bucket list --json >"${work_directory}/buckets.json"
  jq -e --arg bucket "${bucket}" 'all(.[]; .bucketName != $bucket)' \
    "${work_directory}/buckets.json" >/dev/null ||
    fail "the disposable experiment bucket already exists; refusing to reuse it"
}

assert_bucket_removed() {
  run_bootstrap bucket list --json >"${work_directory}/buckets-after-delete.json"
  jq -e --arg bucket "${bucket}" 'all(.[]; .bucketName != $bucket)' \
    "${work_directory}/buckets-after-delete.json" >/dev/null ||
    fail "the disposable experiment bucket still exists"
}

create_key() {
  local runner=$1
  shift
  local response key_id key_secret extra
  response=$("${runner}" key create "$@")
  read -r key_id key_secret extra <<<"${response}"
  [[ -n "${key_id}" && -n "${key_secret}" && -z "${extra:-}" ]] ||
    fail "Backblaze returned an unexpected application-key response"
  printf '%s\t%s\n' "${key_id}" "${key_secret}"
}

verify_key_boundary() {
  local key_name=$1 required_capabilities=$2 expected_prefix=$3
  local runner=${4:-run_admin}
  "${runner}" key list -l >"${work_directory}/keys.txt"
  local line
  line=$(awk -v name="${key_name}" '$2 == name { print; exit }' "${work_directory}/keys.txt")
  [[ -n "${line}" ]] || fail "the temporary application key was not listed"
  local capability
  IFS=, read -ra capabilities <<<"${required_capabilities}"
  for capability in "${capabilities[@]}"; do
    [[ "${line}" =~ (^|,|[[:space:]])${capability}(,|$|[[:space:]]) ]] ||
      fail "the temporary key is missing ${capability}"
  done
  for capability in bypassGovernance writeFileRetentions writeFileLegalHolds; do
    [[ "${line}" != *"${capability}"* ]] ||
      fail "a temporary key unexpectedly has ${capability} authority"
  done
  if [[ -n "${expected_prefix}" ]]; then
    [[ "${line}" == *"'${expected_prefix}/'"* ]] || fail "the temporary data key prefix does not match"
  fi
}

create_maintenance_key() {
  maintenance_key_name=$1
  local maintenance_key capabilities
  capabilities=listKeys,writeKeys,deleteKeys,listBuckets,writeBuckets,deleteBuckets,readBucketRetentions,writeBucketRetentions,readBucketEncryption,writeBucketEncryption
  maintenance_key=$(create_key run_bootstrap --duration 7200 \
    "${maintenance_key_name}" "${capabilities}")
  IFS=$'\t' read -r maintenance_key_id maintenance_application_key <<<"${maintenance_key}"
  verify_key_boundary "${maintenance_key_name}" "${capabilities}" "" run_bootstrap
}

command_name=${1:-}
shift || true

case "${command_name}" in
  start)
    idle_proof=
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --idle-proof) [[ "$#" -ge 2 ]] || usage; idle_proof=$2; shift 2 ;;
        *) usage ;;
      esac
    done
    [[ -n "${idle_proof}" ]] || usage
    validate_idle_proof "${idle_proof}"
    command -v "${restic_bin}" >/dev/null 2>&1 || fail "${restic_bin} is required"

    timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    nonce=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
    prefix="${prefix_root}/${timestamp}-${nonce}/restic"
    validate_prefix "${prefix}"
    key_base="object-lock-${timestamp}-${nonce}"
    policy_key_name="${key_base}-policy"
    data_key_name="${key_base}-data"

    assert_bucket_absent
    create_maintenance_key "${key_base}-maintenance"
    run_admin bucket create "${bucket}" allPrivate >/dev/null
    bucket_created=true
    delete_empty_bucket_on_exit=true
    read_new_unlocked_bucket
    run_admin bucket update --file-lock-enabled "${bucket}" >/dev/null
    read_bucket run_bootstrap
    assert_no_default_retention

    policy_key=$(create_key run_admin \
      --duration 7200 "${policy_key_name}" \
      listBuckets,writeBuckets,readBucketRetentions,writeBucketRetentions,readBucketEncryption)
    IFS=$'\t' read -r policy_key_id policy_application_key <<<"${policy_key}"
    verify_key_boundary "${policy_key_name}" \
      listBuckets,writeBuckets,readBucketRetentions,writeBucketRetentions,readBucketEncryption ""

    data_key=$(create_key run_admin \
      --bucket "${bucket}" --name-prefix "${prefix}/" --duration 14400 \
      "${data_key_name}" \
      listBuckets,listFiles,readFiles,writeFiles,deleteFiles,readFileRetentions)
    IFS=$'\t' read -r data_key_id data_application_key <<<"${data_key}"
    verify_key_boundary "${data_key_name}" \
      listBuckets,listFiles,readFiles,writeFiles,deleteFiles,readFileRetentions "${prefix}"

    run_policy bucket get "${bucket}" >"${work_directory}/bucket.json"
    assert_no_default_retention
    run_policy bucket update --default-retention-mode governance \
      --default-retention-period "1 day" "${bucket}" >/dev/null
    default_enabled=true

    run_policy bucket get "${bucket}" >"${work_directory}/bucket-enabled.json"
    jq -e '
      .fileLockConfiguration.value.defaultRetention.mode == "governance" and
      .fileLockConfiguration.value.defaultRetention.period.duration == 1 and
      .fileLockConfiguration.value.defaultRetention.period.unit == "days"
    ' "${work_directory}/bucket-enabled.json" >/dev/null ||
      fail "the one-day governance default was not observed"

    install -d -m 0700 "${work_directory}/source" "${work_directory}/cache"
    printf '%s\n' 'Disposable Object Lock experiment payload.' >"${work_directory}/source/payload.txt"
    printf '%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" >"${work_directory}/restic-password"
    chmod 0600 "${work_directory}/restic-password"
    export AWS_ACCESS_KEY_ID="${data_key_id}"
    export AWS_SECRET_ACCESS_KEY="${data_application_key}"
    export RESTIC_REPOSITORY="s3:https://${s3_endpoint}/${bucket}/${prefix}"
    export RESTIC_PASSWORD_FILE="${work_directory}/restic-password"
    export RESTIC_CACHE_DIR="${work_directory}/cache"
    delete_empty_bucket_on_exit=false
    "${restic_bin}" init >"${work_directory}/restic-init.log" 2>&1
    "${restic_bin}" backup --host object-lock-experiment \
      --tag object-lock-experiment "${work_directory}/source" \
      >"${work_directory}/restic-backup.log" 2>&1

    run_data ls --recursive --versions --json \
      "b2://${bucket}/${prefix}/" >"${work_directory}/objects.json"
    jq '[.[] | {
      fileName, fileId, size, uploadTimestamp,
      mode: (.fileRetention.value.mode // .fileRetention.mode),
      retainUntilTimestamp: (.fileRetention.value.retainUntilTimestamp // .fileRetention.retainUntilTimestamp)
    }]' "${work_directory}/objects.json" >"${work_directory}/retention.json"
    jq -e 'length > 0 and all(.[];
      .mode == "governance" and
      (.uploadTimestamp | type == "number") and
      (.retainUntilTimestamp | type == "number") and
      (.retainUntilTimestamp - .uploadTimestamp == 86400000)
    )' "${work_directory}/retention.json" >/dev/null ||
      fail "an uploaded disposable object is missing one-day governance retention"

    retain_until_ms=$(jq '[.[].retainUntilTimestamp] | max' "${work_directory}/retention.json")
    retained_bytes=$(jq '[.[].size] | add' "${work_directory}/retention.json")
    retained_objects=$(jq 'length' "${work_directory}/retention.json")
    retained_file_id=$(jq -r '.[0].fileId' "${work_directory}/retention.json")

    remove_default || fail "failed to remove the temporary bucket default retention"
    default_enabled=false
    run_policy bucket get "${bucket}" >"${work_directory}/bucket-disabled.json"
    jq -e '
      .fileLockConfiguration.value.defaultRetention.mode == null and
      .fileLockConfiguration.value.defaultRetention.period == null
    ' "${work_directory}/bucket-disabled.json" >/dev/null ||
      fail "bucket default retention teardown could not be proved"

    if run_data rm --fail-fast --no-progress "b2id://${retained_file_id}" \
      >"${work_directory}/delete.log" 2>&1; then
      fail "pre-expiry deletion unexpectedly succeeded"
    fi
    grep -Eqi 'retention|governance|locked|access denied|not allowed|forbidden' \
      "${work_directory}/delete.log" || fail "pre-expiry deletion failed for an unexpected reason"

    if "${restic_bin}" forget --tag object-lock-experiment --keep-last 0 --prune \
      >"${work_directory}/prune.log" 2>&1; then
      fail "pre-expiry restic prune unexpectedly succeeded"
    fi
    grep -Eqi 'retention|governance|locked|access denied|not allowed|forbidden' \
      "${work_directory}/prune.log" || fail "restic prune failed for an unexpected reason"

    revoke_key "${data_key_id}" || fail "failed to revoke the temporary data key"
    assert_key_revoked "${data_key_name}" || fail "the temporary data key still exists"
    data_key_id=
    data_application_key=
    revoke_key "${policy_key_id}" || fail "failed to revoke the temporary policy key"
    assert_key_revoked "${policy_key_name}" || fail "the temporary policy key still exists"
    policy_key_id=
    policy_application_key=
    revoke_key "${maintenance_key_id}" run_bootstrap || fail "failed to revoke the temporary maintenance key"
    assert_key_revoked "${maintenance_key_name}" run_bootstrap || fail "the temporary maintenance key still exists"
    maintenance_key_id=
    maintenance_application_key=
    unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

    retain_until=$(date -u -d "@$((retain_until_ms / 1000))" +%Y-%m-%dT%H:%M:%SZ)
    expected_cleanup=$(date -u -d "@$((retain_until_ms / 1000 + 300))" +%Y-%m-%dT%H:%M:%SZ)
    jq --null-input \
      --arg prefix "${prefix}" \
      --arg bucket "${bucket}" \
      --arg retainUntil "${retain_until}" \
      --arg expectedCleanupAt "${expected_cleanup}" \
      --argjson retainedBytes "${retained_bytes}" \
      --argjson retainedObjects "${retained_objects}" \
      '{schemaVersion: 1, bucket: $bucket, prefix: $prefix, retainUntil: $retainUntil,
        expectedCleanupAt: $expectedCleanupAt, retainedBytes: $retainedBytes,
        retainedByteDays: $retainedBytes,
        retainedObjects: $retainedObjects, retentionMode: "governance",
        defaultPolicyTeardown: true, directDeleteRejected: true,
        resticPruneRejected: true, temporaryKeysRevoked: true,
        maintenanceKeyRevoked: true}'
    ;;

  cleanup)
    prefix=
    retain_until=
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --prefix) [[ "$#" -ge 2 ]] || usage; prefix=$2; shift 2 ;;
        --retain-until) [[ "$#" -ge 2 ]] || usage; retain_until=$2; shift 2 ;;
        *) usage ;;
      esac
    done
    [[ -n "${prefix}" && -n "${retain_until}" ]] || usage
    validate_prefix "${prefix}"
    retain_until_epoch=$(date -u -d "${retain_until}" +%s 2>/dev/null) ||
      fail "the retain-until timestamp is invalid"
    (( $(date +%s) >= retain_until_epoch )) || fail "retention has not expired"

    read_bucket run_bootstrap
    assert_no_default_retention
    timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    nonce=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
    create_maintenance_key "object-lock-${timestamp}-${nonce}-maintenance"
    cleanup_key_name="object-lock-${timestamp}-${nonce}-cleanup"
    data_key_name=${cleanup_key_name}
    data_key=$(create_key run_admin \
      --bucket "${bucket}" --name-prefix "${prefix}/" --duration 3600 \
      "${cleanup_key_name}" listBuckets,listFiles,readFiles,deleteFiles,readFileRetentions)
    IFS=$'\t' read -r data_key_id data_application_key <<<"${data_key}"
    verify_key_boundary "${cleanup_key_name}" \
      listBuckets,listFiles,readFiles,deleteFiles,readFileRetentions "${prefix}"

    run_data ls --recursive --versions --json \
      "b2://${bucket}/${prefix}/" >"${work_directory}/before-cleanup.json"
    now_ms=$(($(date +%s) * 1000))
    jq -e --argjson now "${now_ms}" '
      length > 0 and all(.[];
        ((.fileRetention.value.retainUntilTimestamp //
          .fileRetention.retainUntilTimestamp // 0) <= $now)
      )
    ' "${work_directory}/before-cleanup.json" >/dev/null ||
      fail "an object in the disposable prefix is still retained"
    run_data rm --recursive --versions --fail-fast --no-progress \
      "b2://${bucket}/${prefix}/" >"${work_directory}/cleanup.log" 2>&1
    run_data ls --recursive --versions --json \
      "b2://${bucket}/${prefix}/" >"${work_directory}/remaining.json"
    jq -e 'length == 0' "${work_directory}/remaining.json" >/dev/null ||
      fail "the disposable repository was not completely removed"
    read_bucket
    assert_no_default_retention
    revoke_key "${data_key_id}" || fail "failed to revoke the temporary cleanup key"
    assert_key_revoked "${data_key_name}" || fail "the temporary cleanup key still exists"
    data_key_id=
    data_application_key=
    run_admin bucket delete "${bucket}" >/dev/null || fail "failed to remove the empty experiment bucket"
    assert_bucket_removed
    revoke_key "${maintenance_key_id}" run_bootstrap || fail "failed to revoke the temporary maintenance key"
    assert_key_revoked "${maintenance_key_name}" run_bootstrap || fail "the temporary maintenance key still exists"
    maintenance_key_id=
    maintenance_application_key=
    jq --null-input --arg bucket "${bucket}" --arg prefix "${prefix}" \
      '{schemaVersion: 1, bucket: $bucket, prefix: $prefix,
        repositoryRemoved: true, bucketRemoved: true,
        cleanupKeyRevoked: true, maintenanceKeyRevoked: true,
        defaultPolicyStillAbsent: true}'
    ;;

  *) usage ;;
esac
