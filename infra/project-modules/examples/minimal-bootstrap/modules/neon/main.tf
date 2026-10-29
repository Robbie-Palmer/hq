terraform {
  required_providers {
    neon = { source = "kislerdm/neon" }
  }
}

variable "neon" {
  type = object({
    org_id                    = string
    project_name              = string
    database_name             = string
    role_name                 = string
    region_id                 = string
    pg_version                = number
    history_retention_seconds = optional(number, 21600)
    preview_project_name      = optional(string)
  })
}

variable "preview_enabled" {
  type    = bool
  default = false
}

resource "neon_project" "production" {
  name       = var.neon.project_name
  region_id  = var.neon.region_id
  pg_version = var.neon.pg_version
  org_id     = var.neon.org_id

  history_retention_seconds = var.neon.history_retention_seconds
  branch {
    name          = "main"
    database_name = var.neon.database_name
    role_name     = var.neon.role_name
  }
}

resource "neon_project" "preview" {
  count      = var.preview_enabled ? 1 : 0
  name       = var.neon.preview_project_name
  region_id  = var.neon.region_id
  pg_version = var.neon.pg_version
  org_id     = var.neon.org_id

  history_retention_seconds = 0
  branch {
    name          = "preview-base"
    database_name = var.neon.database_name
    role_name     = var.neon.role_name
  }
}

output "resource_ownership" {
  value = {
    production_project = neon_project.production.id
    preview_project    = try(neon_project.preview[0].id, null)
  }
}

output "preview_connection_uri" {
  description = "Sensitive connection URI for the isolated preview database."
  value       = try(neon_project.preview[0].connection_uri, null)
  sensitive   = true
}
