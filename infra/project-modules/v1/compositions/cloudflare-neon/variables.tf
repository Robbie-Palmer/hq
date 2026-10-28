variable "resolved_profile" {
  description = "Resolved Copier blueprint for a Cloudflare-and-Neon application."
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
  description = "State boundary for this module instance. This composition accepts only application state."
  type        = string

  validation {
    condition     = var.state_scope == "application"
    error_message = "The Cloudflare-and-Neon composition accepts only state_scope = application."
  }
}

variable "deletion_protection" {
  description = "Keep durable provider resources behind Terraform prevent_destroy guards. Set false only for a reviewed disposable canary."
  type        = bool
  default     = true
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
    custom_domain = optional(object({
      hostname = string
      zone_id  = string
    }))
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
