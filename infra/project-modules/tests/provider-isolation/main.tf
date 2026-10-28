module "project" {
  source = "../../v1/compositions/cloudflare-neon"

  providers = {
    cloudflare = cloudflare
    neon       = neon
  }

  state_scope         = "application"
  deletion_protection = false
  resolved_profile = {
    schema_version = 2
    project = {
      id   = "provider-isolation"
      name = "Provider isolation"
    }
    selections = [
      { slot = "web-app.host", value = "cloudflare-pages" },
      { slot = "database.relational-host", value = "neon" },
    ]
  }
  cloudflare_pages = {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "provider-isolation"
    production_branch  = "main"
    build_command      = ""
    destination_dir    = "site"
    compatibility_date = "2026-10-28"
  }
  neon = {
    org_id                    = "org-example"
    project_name              = "provider-isolation"
    database_name             = "provider_isolation"
    role_name                 = "provider_isolation_owner"
    region_id                 = "aws-us-east-1"
    pg_version                = 17
    history_retention_seconds = 0
  }
}

output "selected_capabilities" {
  value = module.project.selected_capabilities
}

output "resource_ownership" {
  value = module.project.resource_ownership
}
