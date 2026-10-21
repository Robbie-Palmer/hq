locals {
  preview_service_tokens = {
    agents = {
      id   = local.preview_agent_token_id
      name = "personal-site-preview-qa-agents"
    }
    workflow = {
      id   = local.preview_workflow_token_id
      name = "personal-site-preview-qa-workflow"
    }
  }
}

# The generic REST resource deliberately manages only name and duration. The
# Cloudflare endpoint therefore never receives client_secret_version, so a
# Terraform plan or apply cannot rotate either existing credential.
resource "restapi_object" "preview_service_token" {
  for_each = local.preview_service_tokens

  path         = "/access/service_tokens"
  read_path    = "/access/service_tokens"
  update_path  = "/access/service_tokens/{id}"
  destroy_path = "/access/service_tokens/{id}"
  id_attribute = "id"
  data = jsonencode({
    name     = each.value.name
    duration = "forever"
  })

  read_search = {
    search_key   = "id"
    search_value = "{id}"
    results_key  = "result"
  }

  ignore_server_additions = true

  lifecycle {
    prevent_destroy = true
  }
}
