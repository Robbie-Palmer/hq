terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "account_id" { type = string }
variable "name" { type = string }
variable "domain" { type = string }
variable "allowed_emails" { type = set(string) }
variable "session_duration" { type = string }

resource "cloudflare_zero_trust_access_application" "application" {
  account_id                = var.account_id
  name                      = var.name
  domain                    = var.domain
  type                      = "self_hosted"
  session_duration          = var.session_duration
  service_auth_401_redirect = false
  app_launcher_visible      = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "reviewers" {
  account_id     = var.account_id
  application_id = cloudflare_zero_trust_access_application.application.id
  name           = "Approved preview reviewers"
  decision       = "allow"
  precedence     = 1

  include {
    email = var.allowed_emails
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "application_id" {
  value = cloudflare_zero_trust_access_application.application.id
}
