output "pages_preview_application_id" {
  description = "ID of the Access application that protects Cloudflare Pages previews"
  value       = cloudflare_zero_trust_access_application.pages_preview.id
}

output "preview_qa_agent_client_id" {
  description = "Non-secret client ID used by coding agents for preview access"
  value       = restapi_object.preview_service_token["agents"].api_data["client_id"]
}

output "preview_qa_workflow_client_id" {
  description = "Non-secret client ID rotated by the trusted preview QA workflow"
  value       = restapi_object.preview_service_token["workflow"].api_data["client_id"]
}

output "reusable_account_member_policy_id" {
  description = "ID of the shared Cloudflare account-member policy"
  value       = cloudflare_zero_trust_access_policy.cloudflare_account_members.id
}
