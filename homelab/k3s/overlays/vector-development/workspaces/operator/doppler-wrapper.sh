#!/usr/bin/env bash
set -euo pipefail

real_doppler=${DOPPLER_REAL_BIN:-/usr/local/bin/doppler}
token_directory=${DOPPLER_PROJECT_TOKEN_DIRECTORY:-${HOME}/.config/doppler/project-service-tokens}

if [[ -n "${DOPPLER_TOKEN:-}" ]]; then
  exec "${real_doppler}" "$@"
fi

project=${DOPPLER_PROJECT:-}
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
