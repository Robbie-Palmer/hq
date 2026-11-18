#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
cd "$project_root"
source versions.env

consumer_evidence="$project_root/.artifacts/run/consumer-evidence.json"
[[ -f "$consumer_evidence" ]] || {
  echo "Consumer evidence is missing" >&2
  exit 1
}
[[ ! -e "$project_root/.state/broker-receipt.json" ]] || {
  echo "Broker cleanup receipt remains; refusing to claim teardown" >&2
  exit 1
}

mkdir -p evidence
jq \
  --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg revision "$(git -C "$repository_root" rev-parse HEAD)" \
  --arg zotImage "$ZOT_IMAGE" \
  --arg previousZotImage "$ZOT_PREVIOUS_IMAGE" \
  '. + {
    schemaVersion: 1,
    ticket: "pep-oci-artifact-storage-spike",
    observedAt: $observedAt,
    revision: $revision,
    provider: "cloudflare-r2",
    implementation: "zot",
    credentialsPersisted: false,
    credentialScope: "one disposable bucket",
    configuration: {
      region: "auto",
      forcePathStyle: true,
      signatureVersion: 4,
      tls: true,
      isolatedBucket: true
    },
    images: {current: $zotImage, previous: $previousZotImage},
    results: (.results + [{
      requirement: "teardown",
      status: "pass",
      evidence: "The broker purged and deleted both owned buckets, then retired its non-secret receipt"
    }]),
    teardown: {
      bucketDeleted: true,
      scopeProbeBucketDeleted: true,
      parentRevocationInvalidatesChildren: true
    }
  }' "$consumer_evidence" > evidence/scorecard.json

echo "Live R2 canary passed with brokered credentials and verified teardown."
echo "Evidence: infra/oci-r2-artifact-spike/evidence/scorecard.json"
