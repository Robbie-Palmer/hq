#!/usr/bin/env bash
set -euo pipefail

required_values=(
  WORK_GRAPH_COORDINATOR_SCRIPT
  WORK_GRAPH_COORDINATOR_MAX_TICKETS
  WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS
  WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE
  WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION
  WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT
  WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_LIMIT
  WORK_GRAPH_COORDINATOR_IO_PRESSURE_LIMIT
  WORK_GRAPH_COORDINATOR_POLL_SECONDS
  WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS
)
for name in "${required_values[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "${name} is required by the Work Graph agent coordinator runner" >&2
    exit 1
  fi
done
if [ ! -r "${WORK_GRAPH_COORDINATOR_SCRIPT}" ]; then
  echo "cannot read ${WORK_GRAPH_COORDINATOR_SCRIPT}" >&2
  exit 1
fi

pod=
pod_uid=
for _ in $(seq 1 120); do
  pod_record=$(
    k3s kubectl --namespace t3-code get pods \
      --selector=app.kubernetes.io/name=t3-code \
      --field-selector=status.phase=Running \
      --output=json 2>/dev/null \
      | jq --raw-output '
          [.items[]
            | select(
                any(
                  .status.conditions[]?;
                  .type == "Ready" and .status == "True"
                )
              )]
          | .[0]
          | if . == null then empty
            else [.metadata.name, .metadata.uid] | @tsv
            end
        ' \
      || true
  )
  if [ -n "${pod_record}" ]; then
    read -r pod pod_uid <<<"${pod_record}"
    break
  fi
  sleep 2
done
if [ -z "${pod}" ] || [ -z "${pod_uid}" ]; then
  echo "no ready T3 Code pod became available" >&2
  exit 1
fi

exec k3s kubectl --namespace t3-code exec \
  --stdin \
  "${pod}" \
  --container t3-code \
  -- env \
    WORK_GRAPH_COORDINATOR_MAX_TICKETS="${WORK_GRAPH_COORDINATOR_MAX_TICKETS}" \
    WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS="${WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS}" \
    WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE="${WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE}" \
    WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION="${WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION}" \
    WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT="${WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT}" \
    WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_LIMIT="${WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_LIMIT}" \
    WORK_GRAPH_COORDINATOR_IO_PRESSURE_LIMIT="${WORK_GRAPH_COORDINATOR_IO_PRESSURE_LIMIT}" \
    WORK_GRAPH_COORDINATOR_POLL_SECONDS="${WORK_GRAPH_COORDINATOR_POLL_SECONDS}" \
    WORK_GRAPH_COORDINATOR_POD_UID="${pod_uid}" \
    WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS="${WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS}" \
    /bin/bash -s <"${WORK_GRAPH_COORDINATOR_SCRIPT}"
