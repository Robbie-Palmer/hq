import {
  to = cloudflare_zero_trust_access_identity_provider.cloudflare
  id = "accounts/${var.cloudflare_account_id}/${local.cloudflare_identity_provider_id}"
}

import {
  to = cloudflare_zero_trust_access_service_token.preview_qa_agents
  id = "accounts/${var.cloudflare_account_id}/${local.preview_agent_token_id}"
}

import {
  to = cloudflare_zero_trust_access_service_token.preview_qa_workflow
  id = "accounts/${var.cloudflare_account_id}/${local.preview_workflow_token_id}"
}

import {
  to = cloudflare_zero_trust_access_application.pages_preview
  id = "accounts/${var.cloudflare_account_id}/${local.pages_application_id}"
}
