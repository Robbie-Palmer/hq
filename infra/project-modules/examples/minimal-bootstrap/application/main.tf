locals {
  project = {
    id   = "platform-bootstrap-canary"
    name = "Platform bootstrap canary"
  }
}

module "cloudflare" {
  count     = var.enabled ? 1 : 0
  source    = "../../../v1/modules/disposable-cloudflare"
  providers = { cloudflare = cloudflare }

  cloudflare_pages = {
    account_id         = var.cloudflare_account_id
    name               = "platform-bootstrap-canary"
    production_branch  = "bootstrap-canary"
    build_command      = ""
    destination_dir    = "site"
    compatibility_date = "2026-10-27"
    preview_variables = {
      DATA_CLASSIFICATION = "synthetic-only"
    }
    custom_domain = {
      hostname = "bootstrap-canary.robbiepalmer.me"
      zone_id  = var.cloudflare_zone_id
    }
  }

  cloudflare_worker = {
    account_id         = var.cloudflare_account_id
    name               = "platform-bootstrap-canary-preview"
    content            = <<-JAVASCRIPT
      export default {
        fetch() {
          return Response.json({
            project: "platform-bootstrap-canary",
            environment: "preview",
            dataClassification: "synthetic-only"
          });
        }
      };
    JAVASCRIPT
    compatibility_date = "2026-10-27"
    zone_id            = var.cloudflare_zone_id
    hostname           = "bootstrap-canary-worker.robbiepalmer.me"
  }

  cloudflare_access = {
    account_id     = var.cloudflare_account_id
    name           = "Platform bootstrap canary preview"
    domain         = "bootstrap-canary.robbiepalmer.me"
    allowed_emails = var.reviewer_emails
  }
}

module "neon" {
  count     = var.enabled ? 1 : 0
  source    = "../../../v1/modules/disposable-neon"
  providers = { neon = neon }

  preview_enabled = true
  neon = {
    org_id                    = var.neon_org_id
    project_name              = "platform-bootstrap-canary-production-unused"
    database_name             = "bootstrap_canary"
    role_name                 = "bootstrap_canary_owner"
    region_id                 = "aws-us-east-1"
    pg_version                = 17
    history_retention_seconds = 0
    preview_project_name      = "platform-bootstrap-canary-preview"
  }
}

moved {
  from = module.preview.module.disposable[0].cloudflare_pages_project.project
  to   = module.cloudflare[0].cloudflare_pages_project.project
}

moved {
  from = module.preview.module.disposable[0].cloudflare_record.pages_custom_domain
  to   = module.cloudflare[0].cloudflare_record.pages_custom_domain
}

moved {
  from = module.preview.module.disposable[0].cloudflare_pages_domain.project
  to   = module.cloudflare[0].cloudflare_pages_domain.project
}

moved {
  from = module.preview.module.disposable[0].cloudflare_zero_trust_access_application.pages
  to   = module.cloudflare[0].cloudflare_zero_trust_access_application.pages
}

moved {
  from = module.preview.module.disposable[0].cloudflare_zero_trust_access_policy.pages_reviewers
  to   = module.cloudflare[0].cloudflare_zero_trust_access_policy.pages_reviewers
}

moved {
  from = module.preview.module.disposable[0].cloudflare_workers_script.worker
  to   = module.cloudflare[0].cloudflare_workers_script.worker
}

moved {
  from = module.preview.module.disposable[0].cloudflare_workers_domain.worker
  to   = module.cloudflare[0].cloudflare_workers_domain.worker
}

moved {
  from = module.preview.module.disposable[0].cloudflare_zero_trust_access_application.application
  to   = module.cloudflare[0].cloudflare_zero_trust_access_application.application
}

moved {
  from = module.preview.module.disposable[0].cloudflare_zero_trust_access_policy.reviewers
  to   = module.cloudflare[0].cloudflare_zero_trust_access_policy.reviewers
}

moved {
  from = module.preview.module.disposable[0].neon_project.production["selected"]
  to   = module.neon[0].neon_project.production
}

moved {
  from = module.preview.module.disposable[0].neon_project.preview["selected"]
  to   = module.neon[0].neon_project.preview[0]
}

output "selected_capabilities" {
  value = var.enabled ? toset([
    "backend-api.runtime",
    "database.preview-isolation",
    "database.relational-host",
    "security.preview-access",
    "web-app.host",
  ]) : toset([])
}

output "resource_ownership" {
  value = {
    project_id = local.project.id
    cloudflare = try(module.cloudflare[0].resource_ownership, null)
    neon       = try(module.neon[0].resource_ownership, null)
  }
}

output "preview_database_connection_uri" {
  value     = try(module.neon[0].preview_connection_uri, null)
  sensitive = true
}
