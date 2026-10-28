output "selected_capabilities" {
  description = "Stable profile capability names instantiated by this composition."
  value = toset(concat(
    local.selected.cloudflare_pages ? ["web-app.host"] : [],
    local.selected.cloudflare_worker ? ["backend-api.runtime"] : [],
    local.selected.cloudflare_access ? ["security.preview-access"] : [],
    local.selected.cloudflare_r2 ? ["storage.object-store"] : [],
    local.selected.cloudflare_dns ? ["network.public-ingress"] : [],
    local.selected.neon ? ["database.relational-host"] : [],
    local.selected.neon_preview ? ["database.preview-isolation"] : [],
  ))
}

output "state_scope" {
  description = "State owner for the resources returned by this module instance."
  value       = var.state_scope
}

output "deletion_protection" {
  description = "Whether the selected resources use the durable prevent_destroy modules."
  value       = var.deletion_protection
}

output "resource_ownership" {
  description = "Provider resource IDs grouped by the state owner represented by this module instance."
  value = {
    project_id          = var.resolved_profile.project.id
    terraform_workspace = null
    delivery            = null
    pages_project       = try(module.cloudflare_pages["selected"].project_id, module.disposable[0].resource_ownership.pages_project, null)
    pages_domain        = try(module.cloudflare_pages["selected"].domain_id, module.disposable[0].resource_ownership.pages_domain, null)
    pages_access_applications = try(
      module.cloudflare_pages["selected"].access_application_ids,
      module.disposable[0].resource_ownership.pages_access_applications,
      {},
    )
    worker              = try(module.cloudflare_worker["selected"].worker_id, module.disposable[0].resource_ownership.worker, null)
    access_application  = try(module.cloudflare_access["selected"].application_id, module.disposable[0].resource_ownership.access_application, null)
    r2_buckets          = try(module.cloudflare_r2["selected"].bucket_ids, module.disposable[0].resource_ownership.r2_buckets, null)
    dns_records         = try(module.cloudflare_dns["selected"].record_ids, module.disposable[0].resource_ownership.dns_records, null)
    neon                = try(module.neon["selected"].resource_ids, module.disposable[0].resource_ownership.neon, null)
    telemetry_dashboard = null
  }
}

output "preview_database_connection_uri" {
  description = "Sensitive connection URI for the isolated preview database."
  value       = try(module.neon["selected"].preview_connection_uri, module.disposable[0].preview_connection_uri, null)
  sensitive   = true
}
