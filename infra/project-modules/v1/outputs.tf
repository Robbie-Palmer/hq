output "selected_capabilities" {
  description = "Stable profile capability names instantiated by this composition."
  value = toset(concat(
    local.selected.terraform_state ? ["infrastructure.state-backend"] : [],
    local.selected.delivery ? ["delivery.ci"] : [],
    local.selected.cloudflare_pages ? ["web-app.host"] : [],
    local.selected.cloudflare_worker ? ["backend-api.runtime"] : [],
    local.selected.cloudflare_access ? ["security.preview-access"] : [],
    local.selected.cloudflare_r2 ? ["storage.object-store"] : [],
    local.selected.cloudflare_dns ? ["network.public-ingress"] : [],
    local.selected.neon ? ["database.relational-host"] : [],
    local.selected.neon_preview ? ["database.preview-isolation"] : [],
    local.selected.telemetry ? ["observability.application-telemetry"] : [],
  ))
}

output "state_scope" {
  description = "State owner for the resources returned by this module instance."
  value       = var.state_scope
}

output "resource_ownership" {
  description = "Provider resource IDs grouped by the state owner represented by this module instance."
  value = {
    project_id          = var.resolved_profile.project.id
    terraform_workspace = try(module.terraform_state["selected"].workspace_id, null)
    delivery            = try(module.delivery["selected"].resource_ids, null)
    pages_project       = try(module.cloudflare_pages["selected"].project_id, null)
    worker              = try(module.cloudflare_worker["selected"].worker_id, null)
    access_application  = try(module.cloudflare_access["selected"].application_id, null)
    r2_buckets          = try(module.cloudflare_r2["selected"].bucket_ids, null)
    dns_records         = try(module.cloudflare_dns["selected"].record_ids, null)
    neon                = try(module.neon["selected"].resource_ids, null)
    telemetry_dashboard = try(module.telemetry["selected"].dashboard_id, null)
  }
}
