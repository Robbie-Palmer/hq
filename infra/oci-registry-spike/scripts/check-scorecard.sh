#!/usr/bin/env bash
set -euo pipefail

scorecard="${1:?Pass a scorecard JSON path}"
jq --exit-status '
  (.requirements | length) as $requirementCount |
  .schemaVersion == 1 and
  .ticket == "pep-oci-registry-implementation-spike" and
  .recommendation.decision == "reuse" and
  .recommendation.customGateway == false and
  (.requirements | length >= 15) and
  (.implementations | length == 2) and
  (all(.implementations[];
    (.id == "zot" or .id == "distribution") and
    (.measurements.imageBytes > 0) and
    (.results | length == $requirementCount)
  )) and
  .liveR2.status == "not_run"
' "$scorecard" >/dev/null

