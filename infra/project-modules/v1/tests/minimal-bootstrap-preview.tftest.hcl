mock_provider "cloudflare" {}
mock_provider "doppler" {}
mock_provider "github" {}
mock_provider "neon" {}
mock_provider "posthog" {}
mock_provider "tfe" {}

variables {
  state_scope         = "application"
  deletion_protection = false
  resolved_profile    = jsondecode(file("../examples/minimal-bootstrap/infrastructure-profile.json"))
  cloudflare_pages = {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "platform-bootstrap-canary"
    production_branch  = "never-production"
    build_command      = "mise //ui:build"
    destination_dir    = "ui/.next"
    compatibility_date = "2026-10-27"
    preview_variables = {
      DATA_CLASSIFICATION = "synthetic-only"
    }
  }
  cloudflare_worker = {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "platform-bootstrap-canary-preview"
    content            = "export default { fetch() { return Response.json({ environment: 'preview' }); } };"
    compatibility_date = "2026-10-27"
  }
  cloudflare_access = {
    account_id     = "dcd7cd68dd892d610267ded6b1af567b"
    name           = "Platform bootstrap canary preview"
    domain         = "platform-bootstrap-canary.preview.example.com"
    allowed_emails = ["reviewer@example.com"]
  }
  neon = {
    org_id                    = "org-example"
    project_name              = "platform-bootstrap-canary-production-unused"
    database_name             = "bootstrap_canary"
    role_name                 = "bootstrap_canary_owner"
    region_id                 = "aws-us-east-1"
    pg_version                = 17
    history_retention_seconds = 0
    preview_project_name      = "platform-bootstrap-canary-preview"
  }
}

run "create_isolated_preview" {
  command = apply

  assert {
    condition = (
      !output.deletion_protection &&
      output.selected_capabilities == toset([
        "backend-api.runtime",
        "database.preview-isolation",
        "database.relational-host",
        "security.preview-access",
        "web-app.host",
      ]) &&
      output.resource_ownership.pages_project != null &&
      output.resource_ownership.worker != null &&
      output.resource_ownership.access_application != null &&
      output.resource_ownership.neon.production_project != null &&
      output.resource_ownership.neon.preview_project != null &&
      nonsensitive(output.preview_database_connection_uri) != null
    )
    error_message = "The application state must create only the profile-selected Cloudflare and isolated Neon resources."
  }
}

run "reapply_isolated_preview" {
  command = apply

  assert {
    condition = (
      output.resource_ownership.worker != null &&
      output.resource_ownership.neon.preview_project != null
    )
    error_message = "Reapplying the unchanged application profile must preserve the preview resource identities."
  }
}

run "remove_isolated_preview" {
  command = apply

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "platform-bootstrap-canary"
        name = "Platform bootstrap canary"
      }
      selections = []
    }
    cloudflare_pages  = null
    cloudflare_worker = null
    cloudflare_access = null
    neon              = null
  }

  assert {
    condition = (
      length(output.selected_capabilities) == 0 &&
      output.resource_ownership.pages_project == null &&
      output.resource_ownership.worker == null &&
      output.resource_ownership.access_application == null &&
      output.resource_ownership.neon == null &&
      nonsensitive(output.preview_database_connection_uri) == null
    )
    error_message = "Removing the profile selections must clean up every disposable preview resource."
  }
}
