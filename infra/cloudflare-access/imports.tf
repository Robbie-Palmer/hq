import {
  to = cloudflare_zero_trust_access_identity_provider.cloudflare
  id = "accounts/${var.cloudflare_account_id}/${local.cloudflare_identity_provider_id}"
}

import {
  to = restapi_object.preview_service_token["agents"]
  id = "/access/service_tokens/${local.preview_agent_token_id}"
}

import {
  to = restapi_object.preview_service_token["workflow"]
  id = "/access/service_tokens/${local.preview_workflow_token_id}"
}

import {
  to = cloudflare_zero_trust_access_application.pages_preview
  id = "accounts/${var.cloudflare_account_id}/${local.pages_application_id}"
}

# The first migration attempt imported these records through Cloudflare
# provider v5. Drop only those unsafe state representations; the REST imports
# above adopt the same live token IDs without create, delete, or secret rotation.
removed {
  from = cloudflare_zero_trust_access_service_token.preview_qa_agents

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_zero_trust_access_service_token.preview_qa_workflow

  lifecycle {
    destroy = false
  }
}
