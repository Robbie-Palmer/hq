terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "account_id" { type = string }
variable "name" { type = string }
variable "production_branch" { type = string }
variable "build_command" { type = string }
variable "destination_dir" { type = string }
variable "root_dir" { type = string }
variable "production_variables" { type = map(string) }
variable "preview_variables" { type = map(string) }
variable "compatibility_date" { type = string }
variable "compatibility_flags" { type = set(string) }
variable "custom_domain" {
  type = object({
    hostname = string
    zone_id  = string
  })
  default  = null
  nullable = true
}
variable "access" {
  type = object({
    allowed_emails   = set(string)
    session_duration = string
  })
  default  = null
  nullable = true
}

locals {
  custom_domain = var.custom_domain == null ? {} : { selected = var.custom_domain }
  access = var.access == null ? {} : {
    project = {
      allowed_emails   = var.access.allowed_emails
      domain           = "${var.name}.pages.dev"
      name             = "${var.name} Pages"
      session_duration = var.access.session_duration
    }
    previews = {
      allowed_emails   = var.access.allowed_emails
      domain           = "*.${var.name}.pages.dev"
      name             = "${var.name} Pages previews"
      session_duration = var.access.session_duration
    }
  }
}

resource "cloudflare_pages_project" "project" {
  account_id        = var.account_id
  name              = var.name
  production_branch = var.production_branch

  build_config {
    build_command   = var.build_command
    destination_dir = var.destination_dir
    root_dir        = var.root_dir
  }

  deployment_configs {
    production {
      environment_variables = var.production_variables
      compatibility_date    = var.compatibility_date
      compatibility_flags   = var.compatibility_flags
    }

    preview {
      environment_variables = var.preview_variables
      compatibility_date    = var.compatibility_date
      compatibility_flags   = var.compatibility_flags
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_record" "custom_domain" {
  for_each = local.custom_domain

  zone_id = each.value.zone_id
  name    = each.value.hostname
  content = "${var.name}.pages.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_pages_domain" "project" {
  for_each = local.custom_domain

  account_id   = var.account_id
  project_name = var.name
  domain       = each.value.hostname

  depends_on = [cloudflare_record.custom_domain]

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "pages" {
  for_each = local.access

  account_id                = var.account_id
  name                      = each.value.name
  domain                    = each.value.domain
  type                      = "self_hosted"
  session_duration          = each.value.session_duration
  service_auth_401_redirect = false
  app_launcher_visible      = false

  depends_on = [cloudflare_pages_project.project]

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "pages_reviewers" {
  for_each = local.access

  account_id     = var.account_id
  application_id = cloudflare_zero_trust_access_application.pages[each.key].id
  name           = "Approved preview reviewers"
  decision       = "allow"
  precedence     = 1
  include { email = each.value.allowed_emails }

  lifecycle {
    prevent_destroy = true
  }
}

output "project_id" {
  value = cloudflare_pages_project.project.id
}

output "subdomain" {
  value = cloudflare_pages_project.project.subdomain
}

output "domain_id" {
  value = try(cloudflare_pages_domain.project["selected"].id, null)
}

output "access_application_ids" {
  value = {
    for key, application in cloudflare_zero_trust_access_application.pages : key => application.id
  }
}
