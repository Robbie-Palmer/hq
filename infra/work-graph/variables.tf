variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "domain_name" {
  description = "Cloudflare zone that hosts the Work Graph API"
  type        = string
  default     = "robbiepalmer.me"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$", var.domain_name))
    error_message = "domain_name must be a lowercase DNS name without a scheme or path."
  }
}

variable "work_graph_hostname" {
  description = "Access-protected hostname for the Work Graph API"
  type        = string
  default     = "work-graph.robbiepalmer.me"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$", var.work_graph_hostname))
    error_message = "work_graph_hostname must be a lowercase DNS name without a scheme or path."
  }
}

variable "worker_name" {
  description = "Cloudflare Worker service name"
  type        = string
  default     = "work-graph-api"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.worker_name))
    error_message = "worker_name must be a lowercase Cloudflare service name."
  }
}

variable "neon_org_id" {
  description = "Neon organization ID"
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^org-[a-z0-9-]+$", var.neon_org_id))
    error_message = "neon_org_id must begin with org-."
  }
}

variable "neon_project_name" {
  description = "Dedicated Neon project name"
  type        = string
  default     = "work-graph"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.neon_project_name))
    error_message = "neon_project_name must contain lowercase letters, digits, and hyphens."
  }
}

variable "neon_region" {
  description = "Neon deployment region"
  type        = string
  default     = "aws-us-east-1"

  validation {
    condition     = can(regex("^(aws|azure)-[a-z0-9-]+$", var.neon_region))
    error_message = "neon_region must be a Neon AWS or Azure region ID."
  }
}

variable "neon_pg_version" {
  description = "PostgreSQL major version for the Neon project"
  type        = number
  default     = 17

  validation {
    condition     = var.neon_pg_version >= 16 && var.neon_pg_version <= 18 && floor(var.neon_pg_version) == var.neon_pg_version
    error_message = "neon_pg_version must be an integer from 16 through 18."
  }
}

variable "doppler_project" {
  description = "Doppler project that receives Work Graph credentials"
  type        = string
  default     = "work-graph"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{0,63}$", var.doppler_project))
    error_message = "doppler_project must be a Doppler project slug."
  }
}

variable "doppler_config" {
  description = "Doppler config that receives Work Graph credentials"
  type        = string
  default     = "prd_work_graph"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_]{0,63}$", var.doppler_config))
    error_message = "doppler_config must be a lowercase Doppler config name."
  }
}

variable "access_service_token_name" {
  description = "Cloudflare Access service-token name"
  type        = string
  default     = "work-graph-agents"

  validation {
    condition     = length(trimspace(var.access_service_token_name)) >= 3 && length(var.access_service_token_name) <= 200
    error_message = "access_service_token_name must contain from 3 through 200 characters."
  }
}
