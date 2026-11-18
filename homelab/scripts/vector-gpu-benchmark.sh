#!/usr/bin/env bash
set -euo pipefail

namespace=gpu-benchmarks
smoke_image=nvcr.io/nvidia/k8s/cuda-sample@sha256:7c7540bdf1f942d4fb6db97069fd6c289471b54ac29e3c7fcdf914cf77af7d41

usage() {
  echo "usage: vector-gpu-benchmark <create|profile|smoke|status|logs|delete|list> [arguments]" >&2
  echo "  create <run-id> <image@sha256:digest> [-- <container arguments...>]" >&2
  echo "  profile <run-id> <image@sha256:digest> -- <profiled command...>" >&2
  echo "  smoke [run-id]" >&2
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

validate_image() {
  local image=$1
  if [[ ! ${image} =~ ^(nvcr\.io/nvidia/|docker\.io/nvidia/|ghcr\.io/robbie-palmer/)[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
    echo "image must use an approved registry and an exact sha256 digest" >&2
    exit 2
  fi
}

create_job() {
  local mode=$1
  local run_id=$2
  local image=$3
  local container_command=$4
  shift 4
  local name
  local benchmark_args
  name=$(job_name "${run_id}")
  validate_image "${image}"
  benchmark_args=$(jq --compact-output --null-input --args '$ARGS.positional' -- "$@")
  jq --null-input \
      --arg image "${image}" \
      --arg mode "${mode}" \
      --arg name "${name}" \
      --arg run_id "${run_id}" \
      --argjson container_command "${container_command}" \
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
            "gpu-benchmark.homelab.dev/mode": $mode,
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
                "gpu-benchmark.homelab.dev/mode": $mode,
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
                command: $container_command,
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
      }
      | if $container_command == null then
          del(.spec.template.spec.containers[0].command)
        else
          .
        end' \
    | kubectl --namespace "${namespace}" create --filename -
}

action=${1:-}
case "${action}" in
  create)
    [[ $# -ge 3 ]] || usage
    run_id=$2
    image=$3
    shift 3
    if [[ ${1:-} == -- ]]; then
      shift
    fi
    create_job benchmark "${run_id}" "${image}" null "$@"
    ;;
  profile)
    [[ $# -ge 5 && $4 == -- ]] || usage
    run_id=$2
    image=$3
    shift 4
    profile_command=$(jq --compact-output --null-input '[
      "nsys",
      "profile",
      "--sample=none",
      "--trace=cuda,nvtx,osrt",
      "--stats=true",
      "--force-overwrite=true",
      "--output=/tmp/profile"
    ]')
    create_job profile "${run_id}" "${image}" "${profile_command}" "$@"
    ;;
  smoke)
    [[ $# -le 2 ]] || usage
    run_id=${2:-smoke-$(date +%s)}
    name=$(job_name "${run_id}")
    cleanup_smoke() {
      kubectl --namespace "${namespace}" delete job "${name}" \
        --ignore-not-found=true \
        --wait=true >/dev/null
    }
    trap cleanup_smoke EXIT
    create_job smoke "${run_id}" "${smoke_image}" null
    if ! kubectl --namespace "${namespace}" wait \
      --for=condition=complete \
      --timeout=5m \
      "job/${name}"; then
      kubectl --namespace "${namespace}" describe job "${name}" >&2 || true
      kubectl --namespace "${namespace}" logs \
        --container benchmark \
        "job/${name}" >&2 || true
      exit 1
    fi
    kubectl --namespace "${namespace}" logs \
      --container benchmark \
      "job/${name}" \
      | grep -F "Test PASSED"
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
