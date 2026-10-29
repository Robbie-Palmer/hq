mock_provider "cloudflare" {}
mock_provider "neon" {}

run "cloudflare_and_neon_do_not_configure_unselected_providers" {
  command = apply

  variables {
    cloudflare_pages = {
      account_id         = "dcd7cd68dd892d610267ded6b1af567b"
      name               = "provider-isolation"
      production_branch  = "main"
      build_command      = ""
      destination_dir    = "site"
      compatibility_date = "2026-10-29"
    }
    neon = {
      org_id                    = "org-example"
      project_name              = "provider-isolation"
      database_name             = "provider_isolation"
      role_name                 = "provider_isolation_owner"
      region_id                 = "aws-us-east-1"
      pg_version                = 17
      history_retention_seconds = 0
      preview_project_name      = "provider-isolation-preview"
    }
  }

  assert {
    condition = (
      output.selected_capabilities == toset([
        "database.preview-isolation",
        "database.relational-host",
        "web-app.host",
      ]) &&
      output.resource_ownership.pages_project != null &&
      output.resource_ownership.neon.production_project != null &&
      output.resource_ownership.neon.preview_project != null
    )
    error_message = "A Cloudflare-and-Neon profile must plan without configuring unrelated providers."
  }
}
