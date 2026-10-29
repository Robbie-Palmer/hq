locals {
  selection_pairs = toset([
    for selection in var.resolved_profile.selections :
    "${selection.slot}=${selection.value}"
  ])
  selection_slots = toset([
    for selection in var.resolved_profile.selections : selection.slot
  ])

  profile_selected = {
    terraform_state  = contains(local.selection_pairs, "infrastructure.state-backend=terraform-cloud")
    delivery         = contains(local.selection_pairs, "delivery.ci=github-actions")
    cloudflare_pages = contains(local.selection_pairs, "web-app.host=cloudflare-pages")
    cloudflare_worker = contains(
      local.selection_pairs,
      "backend-api.runtime=cloudflare-workers",
    )
    cloudflare_access = contains(local.selection_pairs, "security.preview-access=cloudflare-access")
    cloudflare_r2     = contains(local.selection_pairs, "storage.object-store=cloudflare-r2")
    cloudflare_dns    = contains(local.selection_slots, "network.public-ingress")
    neon              = contains(local.selection_pairs, "database.relational-host=neon")
    neon_preview      = contains(local.selection_slots, "database.preview-isolation")
    telemetry         = contains(local.selection_pairs, "observability.application-telemetry=posthog")
  }

  selected = {
    for capability, selected in local.profile_selected : capability => selected && (
      contains(["terraform_state", "delivery"], capability)
      ? var.state_scope == "bootstrap"
      : var.state_scope == "application"
    )
  }

  supplied = {
    terraform_state   = var.terraform_state != null
    delivery          = var.delivery != null
    cloudflare_pages  = var.cloudflare_pages != null
    cloudflare_worker = var.cloudflare_worker != null
    cloudflare_access = var.cloudflare_access != null
    cloudflare_r2     = var.cloudflare_r2 != null
    cloudflare_dns    = var.cloudflare_dns != null
    neon              = var.neon != null
    telemetry         = var.telemetry != null
  }

  configuration_mismatches = [
    for capability, selected in local.selected : capability
    if capability != "neon_preview" && selected != local.supplied[capability]
  ]
}

resource "terraform_data" "profile_guard" {
  lifecycle {
    precondition {
      condition     = length(local.configuration_mismatches) == 0
      error_message = "Capability configuration must be supplied exactly when selected by the resolved profile. Mismatches: ${join(", ", local.configuration_mismatches)}."
    }

    precondition {
      condition = !local.selected.neon_preview || try(
        local.selected.neon &&
        var.neon.preview_project_name != null &&
        var.neon.preview_project_name != var.neon.project_name,
        false,
      )
      error_message = "database.preview-isolation requires a separate Neon preview project."
    }

    precondition {
      condition = try(
        var.cloudflare_worker == null ||
        (var.cloudflare_worker.zone_id == null) == (var.cloudflare_worker.hostname == null),
        true,
      )
      error_message = "cloudflare_worker zone_id and hostname must be supplied together."
    }
  }
}

module "terraform_state" {
  for_each = var.deletion_protection && local.selected.terraform_state && local.supplied.terraform_state ? { selected = var.terraform_state } : {}
  source   = "./modules/terraform-state"

  depends_on = [terraform_data.profile_guard]

  organization      = each.value.organization
  project_name      = each.value.project_name
  workspace_name    = each.value.workspace_name
  terraform_version = each.value.terraform_version
  tags              = merge(each.value.tags, { project = var.resolved_profile.project.id })
}

module "delivery" {
  for_each = var.deletion_protection && local.selected.delivery && local.supplied.delivery ? { selected = var.delivery } : {}
  source   = "./modules/delivery"

  depends_on = [terraform_data.profile_guard]

  project_id                  = var.resolved_profile.project.id
  doppler_project_name        = each.value.doppler_project_name
  doppler_project_description = each.value.doppler_project_description
  repository                  = each.value.repository
  environments                = each.value.environments
}

module "cloudflare_pages" {
  for_each = var.deletion_protection && local.selected.cloudflare_pages && local.supplied.cloudflare_pages ? { selected = var.cloudflare_pages } : {}
  source   = "./modules/cloudflare-pages"

  depends_on = [terraform_data.profile_guard]

  account_id           = each.value.account_id
  name                 = each.value.name
  production_branch    = each.value.production_branch
  build_command        = each.value.build_command
  destination_dir      = each.value.destination_dir
  root_dir             = each.value.root_dir
  production_variables = each.value.production_variables
  preview_variables    = each.value.preview_variables
  compatibility_date   = each.value.compatibility_date
  compatibility_flags  = each.value.compatibility_flags
  custom_domain        = each.value.custom_domain
  access               = local.selected.cloudflare_access ? var.cloudflare_access : null
}

module "cloudflare_worker" {
  for_each = var.deletion_protection && local.selected.cloudflare_worker && local.supplied.cloudflare_worker ? { selected = var.cloudflare_worker } : {}
  source   = "./modules/cloudflare-worker"

  depends_on = [terraform_data.profile_guard]

  account_id         = each.value.account_id
  name               = each.value.name
  content            = each.value.content
  compatibility_date = each.value.compatibility_date
  zone_id            = each.value.zone_id
  hostname           = each.value.hostname
}

module "cloudflare_access" {
  for_each = var.deletion_protection && local.selected.cloudflare_access && local.supplied.cloudflare_access ? { selected = var.cloudflare_access } : {}
  source   = "./modules/cloudflare-access"

  depends_on = [terraform_data.profile_guard, module.cloudflare_pages]

  account_id       = each.value.account_id
  name             = each.value.name
  domain           = each.value.domain
  allowed_emails   = each.value.allowed_emails
  session_duration = each.value.session_duration
}

module "cloudflare_r2" {
  for_each = var.deletion_protection && local.selected.cloudflare_r2 && local.supplied.cloudflare_r2 ? { selected = var.cloudflare_r2 } : {}
  source   = "./modules/cloudflare-r2"

  depends_on = [terraform_data.profile_guard]

  account_id = each.value.account_id
  buckets    = each.value.buckets
}

module "cloudflare_dns" {
  for_each = var.deletion_protection && local.selected.cloudflare_dns && local.supplied.cloudflare_dns ? { selected = var.cloudflare_dns } : {}
  source   = "./modules/cloudflare-dns"

  depends_on = [terraform_data.profile_guard]

  zone_id = each.value.zone_id
  records = each.value.records
}

module "neon" {
  for_each = var.deletion_protection && local.selected.neon && local.supplied.neon ? { selected = var.neon } : {}
  source   = "./modules/neon"

  depends_on = [terraform_data.profile_guard]

  org_id                    = each.value.org_id
  project_name              = each.value.project_name
  database_name             = each.value.database_name
  role_name                 = each.value.role_name
  region_id                 = each.value.region_id
  pg_version                = each.value.pg_version
  history_retention_seconds = each.value.history_retention_seconds
  preview_enabled           = local.selected.neon_preview
  preview_project_name      = each.value.preview_project_name
}

module "telemetry" {
  for_each = var.deletion_protection && local.selected.telemetry && local.supplied.telemetry ? { selected = var.telemetry } : {}
  source   = "./modules/telemetry"

  depends_on = [terraform_data.profile_guard]

  project_id            = var.resolved_profile.project.id
  dashboard_name        = each.value.dashboard_name
  dashboard_description = each.value.dashboard_description
  tags                  = each.value.tags
}

module "disposable" {
  count  = var.deletion_protection ? 0 : 1
  source = "./modules/disposable"

  depends_on = [terraform_data.profile_guard]

  project_id           = var.resolved_profile.project.id
  terraform_state      = local.selected.terraform_state ? var.terraform_state : null
  delivery             = local.selected.delivery ? var.delivery : null
  cloudflare_pages     = local.selected.cloudflare_pages ? var.cloudflare_pages : null
  cloudflare_worker    = local.selected.cloudflare_worker ? var.cloudflare_worker : null
  cloudflare_access    = local.selected.cloudflare_access ? var.cloudflare_access : null
  cloudflare_r2        = local.selected.cloudflare_r2 ? var.cloudflare_r2 : null
  cloudflare_dns       = local.selected.cloudflare_dns ? var.cloudflare_dns : null
  neon                 = local.selected.neon ? var.neon : null
  neon_preview_enabled = local.selected.neon_preview
  telemetry            = local.selected.telemetry ? var.telemetry : null
}
