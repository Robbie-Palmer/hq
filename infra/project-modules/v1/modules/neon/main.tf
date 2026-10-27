terraform {
  required_providers {
    neon = {
      source = "kislerdm/neon"
    }
  }
}

variable "org_id" { type = string }
variable "project_name" { type = string }
variable "database_name" { type = string }
variable "role_name" { type = string }
variable "region_id" { type = string }
variable "pg_version" { type = number }
variable "history_retention_seconds" { type = number }
variable "preview_enabled" { type = bool }
variable "preview_project_name" {
  type     = string
  default  = null
  nullable = true
}
resource "neon_project" "production" {
  name       = var.project_name
  region_id  = var.region_id
  pg_version = var.pg_version
  org_id     = var.org_id

  history_retention_seconds = var.history_retention_seconds

  branch {
    name          = "main"
    database_name = var.database_name
    role_name     = var.role_name
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "neon_project" "preview" {
  count = var.preview_enabled ? 1 : 0

  name       = var.preview_project_name
  region_id  = var.region_id
  pg_version = var.pg_version
  org_id     = var.org_id

  history_retention_seconds = 0

  branch {
    name          = "preview-base"
    database_name = var.database_name
    role_name     = var.role_name
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "resource_ids" {
  value = {
    production_project = neon_project.production.id
    preview_project    = try(neon_project.preview[0].id, null)
  }
}

output "preview_enabled" {
  value = var.preview_enabled
}

output "preview_connection_uri" {
  description = "Sensitive connection URI for the isolated preview database."
  value       = try(neon_project.preview[0].connection_uri, null)
  sensitive   = true
}
