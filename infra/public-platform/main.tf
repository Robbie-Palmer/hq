data "cloudflare_zone" "domain" {
  name = var.domain_name
}

locals {
  pages_environment_variables = {
    NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH = var.cf_images_account_hash
    NEXT_PUBLIC_POSTHOG_KEY            = var.posthog_key
    NEXT_PUBLIC_POSTHOG_HOST           = var.posthog_host
    POSTHOG_KEY                        = var.posthog_key
    POSTHOG_OTLP_BASE_URL              = var.posthog_otlp_base_url
    RECIPE_API_URL                     = var.recipe_api_url
    RECIPE_API_PREVIEW_ORIGIN_TEMPLATE = var.recipe_api_preview_origin_template
    CF_PAGES_HOST                      = var.cf_pages_host
  }
  pages_production_environment_variables = merge(local.pages_environment_variables, {
    DEPLOYMENT_ENV = "production"
  })
  pages_preview_environment_variables = merge(local.pages_environment_variables, {
    DEPLOYMENT_ENV = "preview"
  })
  pages_secrets = {
    GITHUB_TOKEN = var.github_token
  }
}

resource "cloudflare_pages_project" "personal_site" {
  account_id        = var.cloudflare_account_id
  name              = var.project_name
  production_branch = var.production_branch

  build_config {
    build_caching   = true
    build_command   = "curl https://mise.run | sh && export PATH=\"$HOME/.local/bin:$PATH\" && MISE_IGNORED_CONFIG_PATHS=\"$HOME/.tool-versions\" MISE_EXPERIMENTAL=1 MISE_DISABLE_TOOLS=terraform MISE_YES=1 mise run //ui:build"
    destination_dir = "ui/out"
    root_dir        = ""
  }

  source {
    type = "github"
    config {
      owner                         = var.github_repo_owner
      repo_name                     = var.github_repo_name
      production_branch             = var.production_branch
      pr_comments_enabled           = false
      deployments_enabled           = false
      production_deployment_enabled = false
      preview_deployment_setting    = "none"
      preview_branch_includes       = ["*"]
      preview_branch_excludes       = []
    }
  }

  # Cloudflare keeps the existing GitHub connection working across repository
  # renames, but the provider treats a repo_name change as project replacement.
  lifecycle {
    ignore_changes = [source[0].config[0].repo_name]
  }

  deployment_configs {
    production {
      environment_variables = local.pages_production_environment_variables
      secrets               = local.pages_secrets
      compatibility_date    = "2026-05-28"
      compatibility_flags   = ["nodejs_compat"]
    }

    preview {
      environment_variables = local.pages_preview_environment_variables
      secrets               = local.pages_secrets
      compatibility_date    = "2026-05-28"
      compatibility_flags   = ["nodejs_compat"]
    }
  }
}

resource "cloudflare_pages_domain" "robbiepalmer_me" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.personal_site.name
  domain       = var.domain_name
}

resource "cloudflare_pages_domain" "robbiepalmer_me_www" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.personal_site.name
  domain       = "www.${var.domain_name}"
}

resource "cloudflare_record" "robbiepalmer_me_apex" {
  zone_id = data.cloudflare_zone.domain.id
  name    = "@"
  content = cloudflare_pages_project.personal_site.subdomain
  type    = "CNAME"
  ttl     = 1 # Auto when proxied
  proxied = true
}

resource "cloudflare_record" "robbiepalmer_me_www" {
  zone_id = data.cloudflare_zone.domain.id
  name    = "www"
  content = cloudflare_pages_project.personal_site.subdomain
  type    = "CNAME"
  ttl     = 1 # Auto when proxied
  proxied = true
}

resource "cloudflare_r2_bucket" "map_tiles" {
  account_id = var.cloudflare_account_id
  name       = var.r2_map_tiles_bucket_name
  location   = "ENAM" # Eastern North America - closest to most users
}

resource "cloudflare_r2_bucket" "dvc" {
  account_id = var.cloudflare_account_id
  name       = var.r2_dvc_bucket_name
  location   = "ENAM"
}

# Source images and immutable stage artifact snapshots for recipe ingestion.
resource "cloudflare_r2_bucket" "recipe_artifacts" {
  account_id = var.cloudflare_account_id
  name       = var.r2_recipe_artifacts_bucket_name
  location   = "ENAM"
}

# Synthetic and QA-only artifacts from pull request preview environments.
# Object expiry is configured out of band because Cloudflare provider v4 can
# create R2 buckets but cannot manage lifecycle rules.
resource "cloudflare_r2_bucket" "recipe_artifacts_preview" {
  account_id = var.cloudflare_account_id
  name       = var.r2_recipe_artifacts_preview_bucket_name
  location   = "ENAM"
}

# Private, provider-independent PostgreSQL backups. Objects are encrypted by
# the backup runner before upload, so R2 only receives ciphertext.
resource "cloudflare_r2_bucket" "database_backups" {
  account_id = var.cloudflare_account_id
  name       = var.r2_database_backups_bucket_name
  location   = "ENAM"

  lifecycle {
    prevent_destroy = true
  }
}

# Versioned review-run and finding outcomes for the standalone AI review
# project. Worker bindings are owned by ai-review/wrangler.toml; Terraform owns
# the bucket and prevents application deploys from deleting the corpus.
resource "cloudflare_r2_bucket" "ai_review_data" {
  account_id = var.cloudflare_account_id
  name       = "ai-review-data"
  location   = "ENAM"

  lifecycle {
    prevent_destroy = true
  }
}

# Neon

resource "neon_project" "recipes" {
  name       = "recipes"
  region_id  = var.neon_region
  pg_version = var.neon_pg_version
  org_id     = var.neon_org_id

  history_retention_seconds = 21600 # 6 hours (free plan max)

  lifecycle {
    prevent_destroy = true
  }

  branch {
    name          = "main"
    database_name = "recipes"
    role_name     = "recipes_owner"
  }

  quota {
    compute_time_seconds = 360000     # 100 CU-hours (free plan limit)
    data_transfer_bytes  = 5368709120 # 5 GB (free plan limit)
    logical_size_bytes   = 536870912  # 512 MB per branch (free plan limit)
  }
}

# Disposable, synthetic-only databases for pull request previews. The default
# branch remains empty; CI creates a short-lived child branch and applies the
# complete migration history for each preview run.
resource "neon_project" "recipes_preview" {
  name       = "recipes-preview"
  region_id  = var.neon_region
  pg_version = var.neon_pg_version
  org_id     = var.neon_org_id

  history_retention_seconds = 0

  lifecycle {
    prevent_destroy = true
  }

  branch {
    name          = "preview-base"
    database_name = "recipes"
    role_name     = "recipes_owner"
  }

  quota {
    compute_time_seconds = 360000     # 100 CU-hours (free plan limit)
    data_transfer_bytes  = 5368709120 # 5 GB (free plan limit)
    logical_size_bytes   = 536870912  # 512 MB per branch (free plan limit)
  }
}

# CI can create and delete branches in the preview project, but cannot access
# or mutate the production project through this credential.
resource "neon_org_api_key" "recipes_preview_github_actions" {
  name       = "personal-site-preview-github-actions"
  org_id     = var.neon_org_id
  project_id = neon_project.recipes_preview.id
}

# Hyperdrive — connection pooling from Workers to Neon.
# Uses the direct host (not pooler) because Hyperdrive does its own pooling.

resource "cloudflare_hyperdrive_config" "recipe_db" {
  account_id = var.cloudflare_account_id
  name       = "recipe-db"

  origin = {
    database = neon_project.recipes.database_name
    host     = neon_project.recipes.database_host
    port     = 5432
    user     = neon_project.recipes.database_user
    password = neon_project.recipes.database_password
    scheme   = "postgresql"
  }

  caching = {
    disabled = true
  }
}

# Cloudflare cache

resource "cloudflare_ruleset" "map_tiles_cache" {
  zone_id     = data.cloudflare_zone.domain.id
  name        = "Map tiles cache settings"
  description = "Aggressive caching for immutable map tile images"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    ref         = "map_tiles_edge_cache"
    description = "Cache map tiles at edge for 1 year"
    expression  = "(http.host eq \"${var.r2_map_tiles_subdomain}.${var.domain_name}\")"
    action      = "set_cache_settings"
    action_parameters {
      edge_ttl {
        mode    = "override_origin"
        default = 365 * 24 * 60 * 60 # 1 year in seconds  
      }
      browser_ttl {
        mode    = "override_origin"
        default = 24 * 60 * 60 # 1 day - allows cache busting if tiles are re-generated
      }
    }
  }
}

resource "cloudflare_ruleset" "auth_rate_limit" {
  zone_id     = data.cloudflare_zone.domain.id
  name        = "Auth endpoint rate limiting"
  description = "Per-IP rate limiting for /api/auth/* — returns 429 on abuse. Counting is per Cloudflare data center (cf.colo.id is a mandatory, always-on characteristic; Cloudflare has no global counter)."
  kind        = "zone"
  phase       = "http_ratelimit"

  lifecycle {
    precondition {
      condition     = var.auth_rate_limit_mitigation_timeout >= var.auth_rate_limit_period
      error_message = "auth_rate_limit_mitigation_timeout must be >= auth_rate_limit_period."
    }
  }

  rules {
    ref         = "auth_ip_rate_limit"
    description = "Limit auth requests per IP"
    expression  = "(http.host eq \"${var.domain_name}\" and starts_with(http.request.uri.path, \"/api/auth/\"))"
    # Blocking in the http_ratelimit phase responds with HTTP 429.
    action = "block"

    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = var.auth_rate_limit_period
      requests_per_period = var.auth_rate_limit_requests
      mitigation_timeout  = var.auth_rate_limit_mitigation_timeout
    }
  }
}
