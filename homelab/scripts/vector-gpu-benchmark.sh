#!/usr/bin/env bash
set -euo pipefail

namespace=gpu-benchmarks

usage() {
  echo "usage: vector-gpu-benchmark <create|status|logs|delete|list> [arguments]" >&2
  echo "  create <run-id> <image@sha256:digest> [-- <container arguments...>]" >&2
  echo "  status|logs|delete <run-id>" >&2
  exit 2
}

job_name() {
  local run_id=$1
  if [[ ! ${run_id} =~ ^[a-z0-9]([-a-z0-9]{0,38}[a-z0-9])?$ ]]; then
    echo "run ID must contain 1-40 lowercase letters, digits, or internal hyphens" >&2
    exit 2
  fi
  printf 'gpu-%s\n' "${run_id}"
}

action=${1:-}
case "${action}" in
  create)
    [[ $# -ge 3 ]] || usage
    run_id=$2
    name=$(job_name "${run_id}")
    image=$3
    shift 3
    if [[ ${1:-} == -- ]]; then
      shift
    fi
    if [[ ! ${image} =~ ^(nvcr\.io/nvidia/|docker\.io/nvidia/|ghcr\.io/robbie-palmer/)[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
      echo "image must use an approved registry and an exact sha256 digest" >&2
      exit 2
    fi
    benchmark_args=$(jq --compact-output --null-input --args '$ARGS.positional' -- "$@")
    jq --null-input \
      --arg image "${image}" \
      --arg name "${name}" \
      --arg run_id "${run_id}" \
      --argjson benchmark_args "${benchmark_args}" \
      '{
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: $name,
          namespace: "gpu-benchmarks",
          labels: {
            "app.kubernetes.io/name": "gpu-benchmark",
            "app.kubernetes.io/managed-by": "t3-code",
            "gpu-benchmark.homelab.dev/run-id": $run_id
          }
        },
        spec: {
          activeDeadlineSeconds: 1800,
          backoffLimit: 0,
          completions: 1,
          parallelism: 1,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: {
                "app.kubernetes.io/name": "gpu-benchmark",
                "app.kubernetes.io/managed-by": "t3-code",
                "gpu-benchmark.homelab.dev/run-id": $run_id
              }
            },
            spec: {
              automountServiceAccountToken: false,
              enableServiceLinks: false,
              nodeSelector: {
                "homelab.dev/accelerator": "nvidia",
                "kubernetes.io/hostname": "vector-development"
              },
              restartPolicy: "Never",
              runtimeClassName: "nvidia",
              serviceAccountName: "gpu-benchmark",
              securityContext: {
                runAsGroup: 1000,
                runAsNonRoot: true,
                runAsUser: 1000,
                seccompProfile: {type: "RuntimeDefault"}
              },
              terminationGracePeriodSeconds: 15,
              containers: [{
                name: "benchmark",
                image: $image,
                imagePullPolicy: "IfNotPresent",
                args: $benchmark_args,
                resources: {
                  requests: {
                    cpu: "1",
                    memory: "2Gi",
                    "ephemeral-storage": "1Gi",
                    "nvidia.com/gpu": "1"
                  },
                  limits: {
                    cpu: "8",
                    memory: "16Gi",
                    "ephemeral-storage": "8Gi",
                    "nvidia.com/gpu": "1"
                  }
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  privileged: false,
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  capabilities: {drop: ["ALL"]},
                  seccompProfile: {type: "RuntimeDefault"}
                },
                volumeMounts: [{name: "tmp", mountPath: "/tmp"}]
              }],
              volumes: [{
                name: "tmp",
                emptyDir: {medium: "", sizeLimit: "1Gi"}
              }]
            }
          }
        }
      }' \
      | kubectl --namespace "${namespace}" create --filename -
    ;;
  status)
    [[ $# -eq 2 ]] || usage
    name=$(job_name "$2")
    kubectl --namespace "${namespace}" get job "${name}" --output=wide
    kubectl --namespace "${namespace}" get pods \
      --selector="job-name=${name}" \
      --output=wide
    ;;
  logs)
    [[ $# -eq 2 ]] || usage
    name=$(job_name "$2")
    exec kubectl --namespace "${namespace}" logs \
      --follow \
      --container benchmark \
      "job/${name}"
    ;;
  delete)
    [[ $# -eq 2 ]] || usage
    name=$(job_name "$2")
    exec kubectl --namespace "${namespace}" delete job "${name}" --wait=true
    ;;
  list)
    [[ $# -eq 1 ]] || usage
    exec kubectl --namespace "${namespace}" get jobs,pods --output=wide
    ;;
  *)
    usage
    ;;
esac
