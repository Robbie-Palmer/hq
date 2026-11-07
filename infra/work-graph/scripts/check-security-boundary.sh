#!/usr/bin/env bash
set -euo pipefail

workflow_path="../../.github/workflows/work-graph-infra.yml"

for script in scripts/*.sh scripts/doppler-terraform-env.sh; do
  bash -n "$script"
done

if rg -n 'DOPPLER_TOKEN:.*WORK_GRAPH_DOPPLER_SERVICE_TOKEN' "$workflow_path"; then
  echo "The prd_work_graph write token must not be used to read the infrastructure config." >&2
  exit 1
fi

wrapped_env_count="$(rg -c 'DOPPLER_WORK_GRAPH_TERRAFORM_ENV_WRAPPED: "1"' "$workflow_path")"
if [[ "$wrapped_env_count" != "2" ]]; then
  echo "Work Graph plan and apply must use the protected GitHub environment directly." >&2
  exit 1
fi

forbidden_resource='resource[[:space:]]+"(neon_project|cloudflare_hyperdrive_config|cloudflare_(zero_trust_)?access_service_token|cloudflare_workers?_secret)"'
if rg -n "$forbidden_resource" --glob '*.tf' .; then
  echo "Credential-bearing provider resources are forbidden in the Work Graph Terraform root." >&2
  exit 1
fi

if rg -n 'database_password|connection_uri|client_secret[[:space:]]*=' --glob '*.tf' .; then
  echo "A credential-bearing Terraform expression crossed the Work Graph state boundary." >&2
  exit 1
fi

if rg -n -- '--arg[[:space:]]+(password|database_url|client_id|client_secret)' scripts; then
  echo "Generated credentials must reach jq through protected files, not process arguments." >&2
  exit 1
fi

if rg -n '^(database_password|database_url|service_token_client_id|service_token_secret)=' scripts; then
  echo "Generated credentials must not be retained in shell variables." >&2
  exit 1
fi

echo "Work Graph infrastructure keeps generated credentials outside Terraform configuration."
