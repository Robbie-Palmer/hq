terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
    doppler    = { source = "DopplerHQ/doppler" }
    github     = { source = "integrations/github" }
    neon       = { source = "kislerdm/neon" }
    posthog    = { source = "PostHog/posthog" }
    tfe        = { source = "hashicorp/tfe" }
  }
}

variable "project_id" { type = string }
variable "terraform_state" {
  type = object({
    organization      = string
    project_name      = string
    workspace_name    = string
    terraform_version = string
    tags              = optional(map(string), {})
  })
  default  = null
  nullable = true
}
variable "delivery" {
  type = object({
    doppler_project_name        = string
    doppler_project_description = string
    repository                  = string
    environments = map(object({
      doppler_environment_name = string
      doppler_configs          = set(string)
      github_environment_name  = string
      protected_branches       = optional(bool, false)
      reviewer_usernames       = optional(set(string), [])
    }))
  })
  default  = null
  nullable = true
}
variable "cloudflare_pages" {
  type = object({
    account_id           = string
    name                 = string
    production_branch    = string
    build_command        = string
    destination_dir      = string
    root_dir             = optional(string, "")
    production_variables = optional(map(string), {})
    preview_variables    = optional(map(string), {})
    compatibility_date   = string
    compatibility_flags  = optional(set(string), [])
  })
  default  = null
  nullable = true
}
variable "cloudflare_worker" {
  type = object({
    account_id         = string
    name               = string
    content            = string
    compatibility_date = string
    zone_id            = optional(string)
    hostname           = optional(string)
  })
  default  = null
  nullable = true
}
variable "cloudflare_access" {
  type = object({
    account_id       = string
    name             = string
    domain           = string
    allowed_emails   = set(string)
    session_duration = optional(string, "24h")
  })
  default  = null
  nullable = true
}
variable "cloudflare_r2" {
  type = object({
    account_id = string
    buckets = map(object({
      name     = string
      location = optional(string, "ENAM")
    }))
  })
  default  = null
  nullable = true
}
variable "cloudflare_dns" {
  type = object({
    zone_id = string
    records = map(object({
      name    = string
      content = string
      type    = string
      proxied = optional(bool, true)
      ttl     = optional(number, 1)
    }))
  })
  default  = null
  nullable = true
}
variable "neon" {
  type = object({
    org_id                    = string
    project_name              = string
    database_name             = string
    role_name                 = string
    region_id                 = string
    pg_version                = number
    history_retention_seconds = optional(number, 21600)
    preview_project_name      = optional(string)
  })
  default  = null
  nullable = true
}
variable "neon_preview_enabled" {
  type    = bool
  default = false
}
variable "telemetry" {
  type = object({
    dashboard_name        = string
    dashboard_description = string
    tags                  = optional(set(string), [])
  })
  default  = null
  nullable = true
}

locals {
  terraform_state       = var.terraform_state == null ? {} : { selected = var.terraform_state }
  delivery              = var.delivery == null ? {} : { selected = var.delivery }
  delivery_environments = var.delivery == null ? {} : var.delivery.environments
  delivery_configs = merge(flatten([
    for environment_slug, environment in local.delivery_environments : [{
      for config_name in environment.doppler_configs :
      "${environment_slug}/${config_name}" => {
        environment = environment_slug
        name        = config_name
      }
      if config_name != environment_slug
    }]
  ])...)
  reviewer_usernames = toset(flatten([
    for environment in values(local.delivery_environments) : environment.reviewer_usernames
  ]))
  cloudflare_pages  = var.cloudflare_pages == null ? {} : { selected = var.cloudflare_pages }
  cloudflare_worker = var.cloudflare_worker == null ? {} : { selected = var.cloudflare_worker }
  cloudflare_access = var.cloudflare_access == null ? {} : { selected = var.cloudflare_access }
  cloudflare_r2     = var.cloudflare_r2 == null ? {} : var.cloudflare_r2.buckets
  cloudflare_dns    = var.cloudflare_dns == null ? {} : var.cloudflare_dns.records
  neon              = var.neon == null ? {} : { selected = var.neon }
  telemetry         = var.telemetry == null ? {} : { selected = var.telemetry }
}

resource "tfe_project" "project" {
  for_each     = local.terraform_state
  name         = each.value.project_name
  organization = each.value.organization
  tags         = each.value.tags
}

resource "tfe_workspace" "project" {
  for_each              = local.terraform_state
  name                  = each.value.workspace_name
  organization          = each.value.organization
  project_id            = tfe_project.project[each.key].id
  terraform_version     = each.value.terraform_version
  queue_all_runs        = false
  file_triggers_enabled = true
}

resource "tfe_workspace_settings" "project" {
  for_each             = local.terraform_state
  workspace_id         = tfe_workspace.project[each.key].id
  execution_mode       = "local"
  auto_apply           = false
  global_remote_state  = false
  project_remote_state = false
  tags                 = each.value.tags
}

data "github_user" "reviewer" {
  for_each = local.reviewer_usernames
  username = each.key
}

resource "doppler_project" "project" {
  for_each    = local.delivery
  name        = each.value.doppler_project_name
  description = each.value.doppler_project_description
}

resource "doppler_environment" "project" {
  for_each = local.delivery_environments

  project          = var.delivery.doppler_project_name
  slug             = each.key
  name             = each.value.doppler_environment_name
  personal_configs = false

  depends_on = [doppler_project.project]
}

resource "doppler_config" "project" {
  for_each = local.delivery_configs

  project     = var.delivery.doppler_project_name
  environment = doppler_environment.project[each.value.environment].slug
  name        = each.value.name
}

resource "github_repository_environment" "project" {
  for_each = local.delivery_environments

  repository          = var.delivery.repository
  environment         = each.value.github_environment_name
  can_admins_bypass   = true
  prevent_self_review = false

  dynamic "reviewers" {
    for_each = length(each.value.reviewer_usernames) == 0 ? [] : [each.value.reviewer_usernames]
    content {
      users = [for username in reviewers.value : data.github_user.reviewer[username].id]
    }
  }

  dynamic "deployment_branch_policy" {
    for_each = each.value.protected_branches ? [true] : []
    content {
      protected_branches     = true
      custom_branch_policies = false
    }
  }

  lifecycle {
    precondition {
      condition     = length(each.value.reviewer_usernames) <= 6
      error_message = "GitHub environments support at most six required reviewers."
    }
  }
}

resource "cloudflare_pages_project" "project" {
  for_each          = local.cloudflare_pages
  account_id        = each.value.account_id
  name              = each.value.name
  production_branch = each.value.production_branch

  build_config {
    build_command   = each.value.build_command
    destination_dir = each.value.destination_dir
    root_dir        = each.value.root_dir
  }
  deployment_configs {
    production {
      environment_variables = each.value.production_variables
      compatibility_date    = each.value.compatibility_date
      compatibility_flags   = each.value.compatibility_flags
    }
    preview {
      environment_variables = each.value.preview_variables
      compatibility_date    = each.value.compatibility_date
      compatibility_flags   = each.value.compatibility_flags
    }
  }
}

resource "cloudflare_workers_script" "worker" {
  for_each           = local.cloudflare_worker
  account_id         = each.value.account_id
  name               = each.value.name
  content            = each.value.content
  module             = true
  compatibility_date = each.value.compatibility_date

  lifecycle { ignore_changes = [content] }
}

resource "cloudflare_workers_domain" "worker" {
  for_each = {
    for key, value in local.cloudflare_worker : key => value
    if value.zone_id != null && value.hostname != null
  }
  account_id = each.value.account_id
  zone_id    = each.value.zone_id
  hostname   = each.value.hostname
  service    = cloudflare_workers_script.worker[each.key].name
}

resource "cloudflare_zero_trust_access_application" "application" {
  for_each                  = local.cloudflare_access
  account_id                = each.value.account_id
  name                      = each.value.name
  domain                    = each.value.domain
  type                      = "self_hosted"
  session_duration          = each.value.session_duration
  service_auth_401_redirect = false
  app_launcher_visible      = false
}

resource "cloudflare_zero_trust_access_policy" "reviewers" {
  for_each       = local.cloudflare_access
  account_id     = each.value.account_id
  application_id = cloudflare_zero_trust_access_application.application[each.key].id
  name           = "Approved preview reviewers"
  decision       = "allow"
  precedence     = 1
  include { email = each.value.allowed_emails }
}

resource "cloudflare_r2_bucket" "bucket" {
  for_each   = local.cloudflare_r2
  account_id = var.cloudflare_r2.account_id
  name       = each.value.name
  location   = each.value.location
}

resource "cloudflare_record" "record" {
  for_each = local.cloudflare_dns
  zone_id  = var.cloudflare_dns.zone_id
  name     = each.value.name
  content  = each.value.content
  type     = each.value.type
  proxied  = each.value.proxied
  ttl      = each.value.ttl
}

resource "neon_project" "production" {
  for_each   = local.neon
  name       = each.value.project_name
  region_id  = each.value.region_id
  pg_version = each.value.pg_version
  org_id     = each.value.org_id

  history_retention_seconds = each.value.history_retention_seconds
  branch {
    name          = "main"
    database_name = each.value.database_name
    role_name     = each.value.role_name
  }
}

resource "neon_project" "preview" {
  for_each   = var.neon_preview_enabled ? local.neon : {}
  name       = each.value.preview_project_name
  region_id  = each.value.region_id
  pg_version = each.value.pg_version
  org_id     = each.value.org_id

  history_retention_seconds = 0
  branch {
    name          = "preview-base"
    database_name = each.value.database_name
    role_name     = each.value.role_name
  }
}

resource "posthog_dashboard" "project" {
  for_each    = local.telemetry
  name        = each.value.dashboard_name
  description = each.value.dashboard_description
  pinned      = true
  tags        = setunion(each.value.tags, ["project:${var.project_id}"])
}

output "resource_ownership" {
  value = {
    project_id          = var.project_id
    terraform_workspace = try(tfe_workspace.project["selected"].id, null)
    delivery = var.delivery == null ? null : {
      project_id      = var.project_id
      doppler_project = try(doppler_project.project["selected"].id, null)
      doppler_environments = {
        for key, environment in doppler_environment.project : key => environment.id
      }
      github_environments = {
        for key, environment in github_repository_environment.project : key => environment.id
      }
      doppler_configs = {
        for key, config in doppler_config.project : key => config.id
      }
    }
    pages_project      = try(cloudflare_pages_project.project["selected"].id, null)
    worker             = try(cloudflare_workers_script.worker["selected"].id, null)
    access_application = try(cloudflare_zero_trust_access_application.application["selected"].id, null)
    r2_buckets = var.cloudflare_r2 == null ? null : {
      for key, bucket in cloudflare_r2_bucket.bucket : key => bucket.id
    }
    dns_records = var.cloudflare_dns == null ? null : {
      for key, record in cloudflare_record.record : key => record.id
    }
    neon = var.neon == null ? null : {
      production_project = try(neon_project.production["selected"].id, null)
      preview_project    = try(neon_project.preview["selected"].id, null)
    }
    telemetry_dashboard = try(posthog_dashboard.project["selected"].id, null)
  }
}

output "preview_connection_uri" {
  description = "Sensitive connection URI for the isolated preview database."
  value       = try(neon_project.preview["selected"].connection_uri, null)
  sensitive   = true
}
