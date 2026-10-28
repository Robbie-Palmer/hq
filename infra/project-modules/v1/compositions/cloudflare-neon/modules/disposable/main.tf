terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
    neon       = { source = "kislerdm/neon" }
  }
}

variable "project_id" { type = string }
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
    custom_domain = optional(object({
      hostname = string
      zone_id  = string
    }))
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

locals {
  cloudflare_pages = var.cloudflare_pages == null ? {} : { selected = var.cloudflare_pages }
  cloudflare_pages_custom_domain = var.cloudflare_pages == null || var.cloudflare_pages.custom_domain == null ? {} : {
    selected = merge(var.cloudflare_pages.custom_domain, {
      account_id   = var.cloudflare_pages.account_id
      project_name = var.cloudflare_pages.name
    })
  }
  cloudflare_pages_access = var.cloudflare_pages == null || var.cloudflare_access == null ? {} : {
    project = {
      account_id       = var.cloudflare_pages.account_id
      allowed_emails   = var.cloudflare_access.allowed_emails
      domain           = "${var.cloudflare_pages.name}.pages.dev"
      name             = "${var.cloudflare_pages.name} Pages"
      session_duration = var.cloudflare_access.session_duration
    }
    previews = {
      account_id       = var.cloudflare_pages.account_id
      allowed_emails   = var.cloudflare_access.allowed_emails
      domain           = "*.${var.cloudflare_pages.name}.pages.dev"
      name             = "${var.cloudflare_pages.name} Pages previews"
      session_duration = var.cloudflare_access.session_duration
    }
  }
  cloudflare_worker = var.cloudflare_worker == null ? {} : { selected = var.cloudflare_worker }
  cloudflare_access = var.cloudflare_access == null ? {} : { selected = var.cloudflare_access }
  cloudflare_r2     = var.cloudflare_r2 == null ? {} : var.cloudflare_r2.buckets
  cloudflare_dns    = var.cloudflare_dns == null ? {} : var.cloudflare_dns.records
  neon              = var.neon == null ? {} : { selected = var.neon }
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

resource "cloudflare_record" "pages_custom_domain" {
  for_each = local.cloudflare_pages_custom_domain

  zone_id = each.value.zone_id
  name    = each.value.hostname
  content = "${each.value.project_name}.pages.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1

  depends_on = [cloudflare_pages_project.project]
}

resource "cloudflare_pages_domain" "project" {
  for_each = local.cloudflare_pages_custom_domain

  account_id   = each.value.account_id
  project_name = each.value.project_name
  domain       = each.value.hostname

  depends_on = [cloudflare_record.pages_custom_domain]
}

resource "cloudflare_zero_trust_access_application" "pages" {
  for_each = local.cloudflare_pages_access

  account_id                = each.value.account_id
  name                      = each.value.name
  domain                    = each.value.domain
  type                      = "self_hosted"
  session_duration          = each.value.session_duration
  service_auth_401_redirect = false
  app_launcher_visible      = false

  depends_on = [cloudflare_pages_project.project]
}

resource "cloudflare_zero_trust_access_policy" "pages_reviewers" {
  for_each = local.cloudflare_pages_access

  account_id     = each.value.account_id
  application_id = cloudflare_zero_trust_access_application.pages[each.key].id
  name           = "Approved preview reviewers"
  decision       = "allow"
  precedence     = 1
  include { email = each.value.allowed_emails }
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

  depends_on = [cloudflare_pages_domain.project]
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

output "resource_ownership" {
  value = {
    project_id          = var.project_id
    terraform_workspace = null
    delivery            = null
    pages_project       = try(cloudflare_pages_project.project["selected"].id, null)
    pages_domain        = try(cloudflare_pages_domain.project["selected"].id, null)
    pages_access_applications = {
      for key, application in cloudflare_zero_trust_access_application.pages : key => application.id
    }
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
    telemetry_dashboard = null
  }
}

output "preview_connection_uri" {
  description = "Sensitive connection URI for the isolated preview database."
  value       = try(neon_project.preview["selected"].connection_uri, null)
  sensitive   = true
}
