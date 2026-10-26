#!/usr/bin/env bash
set -euo pipefail

real_doppler=${DOPPLER_REAL_BIN:-/usr/local/bin/doppler}
token_directory=${DOPPLER_PROJECT_TOKEN_DIRECTORY:-${HOME}/.config/doppler/project-service-tokens}

project=${DOPPLER_PROJECT:-}
config=${DOPPLER_CONFIG:-}
arguments=("$@")
for ((index = 0; index < ${#arguments[@]}; index++)); do
  argument=${arguments[index]}
  case "${argument}" in
    --)
      break
      ;;
    --project|-p)
      if ((index + 1 >= ${#arguments[@]})); then
        echo "${argument} requires a project" >&2
        exit 2
      fi
      project=${arguments[index + 1]}
      ((index += 1))
      ;;
    --project=*|-p=*)
      project=${argument#*=}
      ;;
    --config|-c)
      if ((index + 1 >= ${#arguments[@]})); then
        echo "${argument} requires a config" >&2
        exit 2
      fi
      config=${arguments[index + 1]}
      ((index += 1))
      ;;
    --config=*|-c=*)
      config=${argument#*=}
      ;;
    --token|--token=*|--no-read-env)
      echo "Vector Doppler access does not accept caller-supplied token options" >&2
      exit 2
      ;;
    *)
      ;;
  esac
done

case "${project}" in
  ai-review)
    token_variable=DOPPLER_TOKEN_AI_REVIEW
    ;;
  homelab)
    token_variable=DOPPLER_TOKEN_HOMELAB
    ;;
  personal-site)
    token_variable=DOPPLER_TOKEN_PERSONAL_SITE
    ;;
  work-graph)
    token_variable=DOPPLER_TOKEN_WORK_GRAPH
    ;;
  "")
    echo "Vector Doppler access requires --project, -p, or DOPPLER_PROJECT" >&2
    exit 2
    ;;
  *)
    echo "Vector Doppler access is not configured for project ${project}" >&2
    exit 2
    ;;
esac

case "${config}" in
  ""|dev)
    ;;
  *)
    echo "Vector Doppler access is only configured for the dev config" >&2
    exit 2
    ;;
esac

token=${!token_variable:-}
token_file=${token_directory}/${project}
if [[ -z "${token}" && -s "${token_file}" ]]; then
  token=$(<"${token_file}")
fi
if [[ -z "${token}" ]]; then
  echo "Vector Doppler token is missing for project ${project}" >&2
  exit 1
fi

export DOPPLER_TOKEN
DOPPLER_TOKEN=${token}
unset token
exec "${real_doppler}" "$@"
