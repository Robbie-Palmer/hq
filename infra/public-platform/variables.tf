variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "project_name" {
  description = "Name of the Cloudflare Pages project"
  type        = string
  default     = "personal-site"
}

variable "production_branch" {
  description = "Git branch for production deployments"
  type        = string
  default     = "main"
}

variable "github_repo_owner" {
  description = "GitHub repository owner/organization"
  type        = string
}

variable "github_repo_name" {
  description = "GitHub repository name"
  type        = string
}

variable "domain_name" {
  description = "The domain name for the personal site"
  type        = string
  default     = "robbiepalmer.me"
}

variable "cf_images_account_hash" {
  description = "Cloudflare Images account hash"
  type        = string
}

variable "r2_map_tiles_bucket_name" {
  description = "Name of the R2 bucket for map tiles"
  type        = string
  default     = "map-tiles"
}

variable "r2_map_tiles_subdomain" {
  description = "Subdomain for serving map tiles (e.g. 'tiles' for tiles.robbiepalmer.me)"
  type        = string
  default     = "tiles"
}

variable "posthog_key" {
  description = "PostHog project API key"
  type        = string
  sensitive   = true
}

variable "posthog_api_key" {
  description = "PostHog personal API key used to manage resources through Terraform"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub personal access token for mise tool downloads in Cloudflare Pages builds"
  type        = string
  sensitive   = true
}

variable "posthog_host" {
  description = "PostHog host URL"
  type        = string
  default     = "https://eu.posthog.com"
}

variable "posthog_otlp_base_url" {
  description = "Regional PostHog OTLP ingestion base URL"
  type        = string
  default     = "https://eu.i.posthog.com"

  validation {
    condition     = can(regex("^https://[^/?#]+$", var.posthog_otlp_base_url))
    error_message = "posthog_otlp_base_url must be an HTTPS origin with no path, query string, or fragment."
  }
}

variable "posthog_project_id" {
  description = "PostHog project/environment ID used by the Terraform provider"
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.posthog_project_id)) > 0
    error_message = "posthog_project_id must be provided via TF_VAR_posthog_project_id or POSTHOG_PROJECT_ID."
  }
}

variable "r2_dvc_bucket_name" {
  description = "Name of the R2 bucket for DVC data storage"
  type        = string
  default     = "dvc"
}

variable "r2_recipe_artifacts_bucket_name" {
  description = "Name of the R2 bucket for recipe ingestion source images and artifact snapshots"
  type        = string
  default     = "recipe-artifacts"
}

variable "r2_recipe_artifacts_preview_bucket_name" {
  description = "Name of the shared R2 bucket for ephemeral recipe ingestion preview artifacts"
  type        = string
  default     = "recipe-artifacts-preview"
}

variable "r2_database_backups_bucket_name" {
  description = "Name of the private R2 bucket for encrypted PostgreSQL backups"
  type        = string
  default     = "personal-site-database-backups"
}

variable "r2_workspace_backups_bucket_name" {
  description = "Name of the private R2 bucket for encrypted remote workspace backups"
  type        = string
  default     = "personal-site-workspace-backups"
}

variable "recipe_api_url" {
  description = "URL of the recipe-api Worker for the auth proxy"
  type        = string
  default     = "https://recipe-api.robbiepalmer95.workers.dev"
}

variable "recipe_api_preview_origin_template" {
  description = "Preview Worker origin template; {pr} is replaced with the PR number"
  type        = string
  default     = "https://recipe-api-pr-{pr}.robbiepalmer95.workers.dev"

  validation {
    condition = (
      length(regexall("\\{pr\\}", var.recipe_api_preview_origin_template)) == 1 &&
      can(regex("^https://[A-Za-z0-9.-]*\\{pr\\}[A-Za-z0-9.-]*(:[0-9]+)?$", var.recipe_api_preview_origin_template))
    )
    error_message = "recipe_api_preview_origin_template must be an HTTPS origin template containing exactly one {pr} placeholder and no path or query."
  }
}

variable "cf_pages_host" {
  description = "Cloudflare Pages project hostname used to recognize canonical PR aliases"
  type        = string
  default     = "personal-site-bu5.pages.dev"

  validation {
    condition = (
      can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$", var.cf_pages_host)) &&
      length(regexall("\\.", var.cf_pages_host)) > 0 &&
      length(regexall("\\.\\.", var.cf_pages_host)) == 0
    )
    error_message = "cf_pages_host must be a hostname only, with no scheme, path, query, or empty labels."
  }
}

variable "cloudflare_pages_preview_access_application_id" {
  description = "Account-level Access application ID created by Cloudflare Pages preview protection"
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.cloudflare_pages_preview_access_application_id))
    error_message = "cloudflare_pages_preview_access_application_id must be a lowercase UUID."
  }
}

variable "auth_rate_limit_requests" {
  description = "Max auth requests per IP within the counting period before the edge returns 429"
  type        = number
  default     = 20

  validation {
    condition     = var.auth_rate_limit_requests > 0
    error_message = "auth_rate_limit_requests must be greater than zero."
  }
}

variable "auth_rate_limit_period" {
  description = "Counting period in seconds for edge auth rate limiting"
  type        = number
  default     = 10

  validation {
    condition     = contains([10, 60, 120, 300, 600, 3600], var.auth_rate_limit_period)
    error_message = "auth_rate_limit_period must be one of 10, 60, 120, 300, 600, 3600 seconds."
  }
}

variable "auth_rate_limit_mitigation_timeout" {
  description = "Seconds to keep blocking an IP after it trips the auth rate limit (must be >= the period)"
  type        = number
  default     = 10

  validation {
    condition     = var.auth_rate_limit_mitigation_timeout >= 10
    error_message = "auth_rate_limit_mitigation_timeout must be at least 10 seconds."
  }
}

# Neon

variable "neon_org_id" {
  description = "Neon organization ID"
  type        = string
}

variable "neon_region" {
  description = "Neon deployment region"
  type        = string
  default     = "aws-us-east-1"
}

variable "neon_pg_version" {
  description = "Postgres version for Neon project"
  type        = number
  default     = 17
}

variable "slack_webhook_url" {
  description = "Slack incoming webhook URL used by Cloudflare notification policies"
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^https://hooks\\.slack\\.com/services/[^/]+/[^/]+/[^/]+$", var.slack_webhook_url))
    error_message = "slack_webhook_url must be a Slack incoming webhook URL of the form https://hooks.slack.com/services/T.../B.../...."
  }
}
