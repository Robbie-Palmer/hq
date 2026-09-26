output "api_origin" {
  description = "Access-protected Work Graph API origin"
  value       = local.api_origin
}

output "access_application_aud" {
  description = "Cloudflare Access application audience"
  value       = cloudflare_zero_trust_access_application.work_graph.aud
}

output "hyperdrive_config_id" {
  description = "Work Graph Hyperdrive configuration ID"
  value       = data.external.resource_metadata.result.hyperdrive_id
}

output "neon_project_id" {
  description = "Dedicated Work Graph Neon project ID"
  value       = data.external.resource_metadata.result.neon_project_id
}

output "r2_database_backups_bucket_name" {
  description = "Dedicated bucket for encrypted Work Graph PostgreSQL backups"
  value       = cloudflare_r2_bucket.database_backups.name
}

output "worker_name" {
  description = "Work Graph Worker service name"
  value       = cloudflare_workers_script.work_graph.name
}
