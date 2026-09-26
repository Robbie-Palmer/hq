data "cloudflare_zone" "domain" {
  name = var.domain_name
}

locals {
  api_origin                  = "https://${var.work_graph_hostname}"
  credential_handoff_revision = filesha256("${path.module}/scripts/provision-sensitive-resources.sh")
  hyperdrive_name             = "work-graph-db"
}

check "work_graph_hostname_in_zone" {
  assert {
    condition     = var.work_graph_hostname != var.domain_name && endswith(var.work_graph_hostname, ".${var.domain_name}")
    error_message = "work_graph_hostname must be a subdomain of domain_name."
  }
}

# The provider resources for Neon, Hyperdrive, and Cloudflare service tokens
# would put passwords in Terraform state. A local-exec helper creates them and
# writes their credentials straight to Doppler. State records only public
# metadata and the helper revision.
resource "terraform_data" "credential_handoff" {
  # Prove Cloudflare can create Access applications before creating external
  # resources whose credentials cannot be recovered from Terraform state.
  depends_on = [cloudflare_zero_trust_access_application.work_graph]

  triggers_replace = {
    api_origin            = local.api_origin
    cloudflare_account_id = var.cloudflare_account_id
    doppler_config        = "${var.doppler_project}/${var.doppler_config}"
    hyperdrive_name       = local.hyperdrive_name
    neon_org_id           = var.neon_org_id
    neon_pg_version       = tostring(var.neon_pg_version)
    neon_region           = var.neon_region
    project_name          = var.neon_project_name
    script_revision       = local.credential_handoff_revision
    token_name            = var.access_service_token_name
  }

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/provision-sensitive-resources.sh"
    environment = {
      CLOUDFLARE_ACCOUNT_ID         = var.cloudflare_account_id
      DOPPLER_CONFIG                = var.doppler_config
      DOPPLER_PROJECT               = var.doppler_project
      NEON_DATABASE_NAME            = "work_graph"
      NEON_ORG_ID                   = var.neon_org_id
      NEON_PG_VERSION               = tostring(var.neon_pg_version)
      NEON_PROJECT_NAME             = var.neon_project_name
      NEON_REGION                   = var.neon_region
      NEON_ROLE_NAME                = "work_graph_owner"
      WORK_GRAPH_API_ORIGIN         = local.api_origin
      WORK_GRAPH_HYPERDRIVE_NAME    = local.hyperdrive_name
      WORK_GRAPH_SERVICE_TOKEN_NAME = var.access_service_token_name
    }
  }
}

# This helper returns IDs and connection coordinates only. Passwords and
# connection strings never cross the external-data protocol into state.
data "external" "resource_metadata" {
  depends_on = [terraform_data.credential_handoff]
  program    = ["bash", "${path.module}/scripts/read-resource-metadata.sh"]

  query = {
    cloudflare_account_id = var.cloudflare_account_id
    hyperdrive_name       = local.hyperdrive_name
    neon_database_name    = "work_graph"
    neon_org_id           = var.neon_org_id
    neon_project_name     = var.neon_project_name
    neon_role_name        = "work_graph_owner"
    service_token_name    = var.access_service_token_name
  }
}

resource "terraform_data" "hyperdrive_credentials" {
  triggers_replace = {
    hyperdrive_id = data.external.resource_metadata.result.hyperdrive_id
    origin_coordinates_sha256 = sha256(jsonencode({
      branch_id  = data.external.resource_metadata.result.neon_branch_id
      database   = data.external.resource_metadata.result.database_name
      host       = data.external.resource_metadata.result.database_host
      project_id = data.external.resource_metadata.result.neon_project_id
      user       = data.external.resource_metadata.result.database_user
    }))
    script_revision = filesha256("${path.module}/scripts/install-hyperdrive-origin.sh")
  }

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/install-hyperdrive-origin.sh"
    environment = {
      CLOUDFLARE_ACCOUNT_ID      = var.cloudflare_account_id
      DOPPLER_CONFIG             = var.doppler_config
      DOPPLER_PROJECT            = var.doppler_project
      NEON_BRANCH_ID             = data.external.resource_metadata.result.neon_branch_id
      NEON_DATABASE_HOST         = data.external.resource_metadata.result.database_host
      NEON_DATABASE_NAME         = data.external.resource_metadata.result.database_name
      NEON_PROJECT_ID            = data.external.resource_metadata.result.neon_project_id
      NEON_ROLE_NAME             = data.external.resource_metadata.result.database_user
      WORK_GRAPH_API_ORIGIN      = local.api_origin
      WORK_GRAPH_HYPERDRIVE_ID   = data.external.resource_metadata.result.hyperdrive_id
      WORK_GRAPH_HYPERDRIVE_NAME = local.hyperdrive_name
    }
  }
}

resource "cloudflare_workers_script" "work_graph" {
  account_id         = var.cloudflare_account_id
  name               = var.worker_name
  content            = file("${path.module}/bootstrap-worker.mjs")
  module             = true
  compatibility_date = "2026-09-15"

  hyperdrive_config_binding {
    binding = "HYPERDRIVE"
    id      = data.external.resource_metadata.result.hyperdrive_id
  }

  lifecycle {
    # Wrangler owns application versions after Terraform claims the service
    # name and installs the binding on the bootstrap version.
    ignore_changes = [content]
  }
}

resource "cloudflare_workers_domain" "work_graph" {
  account_id = var.cloudflare_account_id
  zone_id    = data.cloudflare_zone.domain.id
  hostname   = var.work_graph_hostname
  service    = cloudflare_workers_script.work_graph.name
}

resource "cloudflare_zero_trust_access_application" "work_graph" {
  account_id                = var.cloudflare_account_id
  name                      = "Work Graph API"
  domain                    = var.work_graph_hostname
  type                      = "self_hosted"
  session_duration          = "24h"
  service_auth_401_redirect = false
  app_launcher_visible      = false
}

resource "cloudflare_zero_trust_access_policy" "work_graph_service_auth" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.work_graph.id
  name           = "Work Graph agents"
  decision       = "non_identity"
  precedence     = 1

  include {
    service_token = [data.external.resource_metadata.result.service_token_id]
  }
}
