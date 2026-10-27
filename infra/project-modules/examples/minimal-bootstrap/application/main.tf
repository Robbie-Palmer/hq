locals {
  project = {
    id   = "platform-bootstrap-canary"
    name = "Platform bootstrap canary"
  }
  resolved_profile = var.enabled ? jsondecode(file("${path.module}/../infrastructure-profile.json")) : {
    schema_version = 2
    project        = local.project
    selections     = []
  }
}

module "preview" {
  source = "../../../v1"

  state_scope         = "application"
  deletion_protection = false
  resolved_profile    = local.resolved_profile

  cloudflare_pages = var.enabled ? {
    account_id         = var.cloudflare_account_id
    name               = "platform-bootstrap-canary"
    production_branch  = "never-production"
    build_command      = ""
    destination_dir    = "site"
    compatibility_date = "2026-10-27"
    preview_variables = {
      DATA_CLASSIFICATION = "synthetic-only"
    }
  } : null

  cloudflare_worker = var.enabled ? {
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
  } : null

  cloudflare_access = var.enabled ? {
    account_id     = var.cloudflare_account_id
    name           = "Platform bootstrap canary preview"
    domain         = "bootstrap-canary.platform-bootstrap-canary.pages.dev"
    allowed_emails = var.reviewer_emails
  } : null

  neon = var.enabled ? {
    org_id                    = var.neon_org_id
    project_name              = "platform-bootstrap-canary-production-unused"
    database_name             = "bootstrap_canary"
    role_name                 = "bootstrap_canary_owner"
    region_id                 = "aws-us-east-1"
    pg_version                = 17
    history_retention_seconds = 0
    preview_project_name      = "platform-bootstrap-canary-preview"
  } : null
}

output "selected_capabilities" {
  value = module.preview.selected_capabilities
}

output "resource_ownership" {
  value = module.preview.resource_ownership
}

output "preview_database_connection_uri" {
  value     = module.preview.preview_database_connection_uri
  sensitive = true
}
