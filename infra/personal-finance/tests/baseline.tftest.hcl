mock_provider "cloudflare" {}
mock_provider "neon" {}
mock_provider "posthog" {}
mock_provider "restapi" {}

variables {
  cloudflare_worker = {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "personal-finance-api"
    content            = "export default { fetch() { return new Response('canary'); } };"
    compatibility_date = "2026-10-01"
    hyperdrive_id      = "7c2d44d36f5c4f55b2f8a3f29f62a2f1"
  }
  cloudflare_access = {
    account_id     = "dcd7cd68dd892d610267ded6b1af567b"
    name           = "Personal Finance preview"
    domain         = "personal-finance-preview.example.com"
    allowed_emails = ["reviewer@example.com"]
  }
  cloudflare_r2 = {
    account_id = "dcd7cd68dd892d610267ded6b1af567b"
    buckets = {
      backups = { name = "personal-finance-backups" }
    }
  }
  neon = {
    org_id               = "org-example"
    project_name         = "personal-finance"
    preview_project_name = "personal-finance-preview"
    database_name        = "personal_finance"
    role_name            = "personal_finance"
    region_id            = "aws-eu-west-2"
    pg_version           = 17
  }
  telemetry = {
    dashboard_name        = "Personal Finance operations"
    dashboard_description = "Synthetic canary telemetry"
    tags                  = ["personal-finance"]
  }
  posthog_alerting = {
    host       = "https://eu.posthog.com"
    project_id = "12345"
    alerts = {
      api_errors = {
        name            = "Personal Finance API errors"
        service_names   = ["personal-finance-api"]
        threshold_count = 1
      }
    }
  }
  posthog_api_key = "test-only"
}

run "generated_stateful_canary" {
  command = plan

  assert {
    condition = output.selected_capabilities == toset([
      "backend-api.runtime",
      "database.backup-restore",
      "database.preview-isolation",
      "database.relational-host",
      "observability.alert-delivery",
      "observability.alert-evaluation",
      "observability.application-telemetry",
      "observability.telemetry-protocol",
      "security.preview-access",
      "storage.object-store",
    ])
    error_message = "The Personal Finance root must retain its generated stateful capabilities."
  }
}
