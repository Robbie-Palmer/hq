variable "resolved_profile" {
  description = "Resolved Copier blueprint. Infrastructure is selected only from its stable selection slots."
  type = object({
    schema_version = number
    project = object({
      id   = string
      name = string
    })
    selections = list(object({
      slot  = string
      value = string
    }))
  })

  validation {
    condition     = var.resolved_profile.schema_version == 2
    error_message = "The v1 module library accepts only resolved blueprint schema version 2."
  }
}

variable "state_scope" {
  description = "State boundary for this module instance. Bootstrap owns Terraform state and delivery containers; application owns workload resources."
  type        = string

  validation {
    condition     = contains(["bootstrap", "application"], var.state_scope)
    error_message = "state_scope must be bootstrap or application."
  }
}

variable "deletion_protection" {
  description = "Keep durable provider resources behind Terraform prevent_destroy guards. Set false only for a reviewed disposable canary."
  type        = bool
  default     = true
}

variable "terraform_state" {
  description = "HCP Terraform state boundary. Supply only when infrastructure.state-backend is selected."
  type = object({
    organization      = string
    project_name      = string
    workspace_name    = string
    terraform_version = string
    tags              = optional(map(string), {})
  })
  default  = null
  nullable = true
}

variable "delivery" {
  description = "Doppler and GitHub delivery boundaries. Supply only when delivery.ci is selected."
  type = object({
    doppler_project_name        = string
    doppler_project_description = string
    repository                  = string
    environments = map(object({
      doppler_environment_name = string
      doppler_configs          = set(string)
      github_environment_name  = string
      protected_branches       = optional(bool, false)
      reviewer_usernames       = optional(set(string), [])
    }))
  })
  default  = null
  nullable = true
}

variable "cloudflare_pages" {
  description = "Cloudflare Pages project configuration. Supply only when web-app.host selects cloudflare-pages."
  type = object({
    account_id           = string
    name                 = string
    production_branch    = string
    build_command        = string
    destination_dir      = string
    root_dir             = optional(string, "")
    production_variables = optional(map(string), {})
    preview_variables    = optional(map(string), {})
    compatibility_date   = string
    compatibility_flags  = optional(set(string), [])
  })
  default  = null
  nullable = true
}

variable "cloudflare_worker" {
  description = "Cloudflare Worker bootstrap configuration. Supply only when backend-api.runtime selects cloudflare-workers."
  type = object({
    account_id         = string
    name               = string
    content            = string
    compatibility_date = string
    zone_id            = optional(string)
    hostname           = optional(string)
  })
  default  = null
  nullable = true
}

variable "cloudflare_access" {
  description = "Cloudflare Access application configuration. Supply only when security.preview-access is selected."
  type = object({
    account_id       = string
    name             = string
    domain           = string
    allowed_emails   = set(string)
    session_duration = optional(string, "24h")
  })
  default  = null
  nullable = true
}

variable "cloudflare_r2" {
  description = "Project-owned R2 buckets. Supply only when storage.object-store selects cloudflare-r2."
  type = object({
    account_id = string
    buckets = map(object({
      name     = string
      location = optional(string, "ENAM")
    }))
  })
  default  = null
  nullable = true
}

variable "cloudflare_dns" {
  description = "Project-owned DNS records. Supply only when network.public-ingress is selected."
  type = object({
    zone_id = string
    records = map(object({
      name    = string
      content = string
      type    = string
      proxied = optional(bool, true)
      ttl     = optional(number, 1)
    }))
  })
  default  = null
  nullable = true
}

variable "neon" {
  description = "Neon production and optional preview project configuration. Supply only when database.relational-host selects neon."
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
  default  = null
  nullable = true
}

variable "telemetry" {
  description = "PostHog project dashboard configuration. Supply only when observability.application-telemetry selects posthog."
  type = object({
    dashboard_name        = string
    dashboard_description = string
    tags                  = optional(set(string), [])
  })
  default  = null
  nullable = true
}
