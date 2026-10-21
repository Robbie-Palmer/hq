locals {
  cloudflare_identity_provider_id = "69e998ae-23eb-45a4-b2ed-6f13bb62040b"
  pages_application_id            = "6a6fe70f-7fac-4416-8a76-914c439e4d4e"
  pages_human_policy_id           = "c275b7a3-6095-4b53-a5df-f7121ce84e38"
  pages_service_policy_id         = "4b19cc49-b3fb-4c56-a0e6-fd88b3740743"
  preview_agent_token_id          = "5083f895-a6cd-430c-85c7-e422baa934de" # gitleaks:allow -- public resource UUID
  preview_workflow_token_id       = "c95f960c-8f05-4d9b-a172-ea48efada399" # gitleaks:allow -- public resource UUID
}

data "cloudflare_zero_trust_access_groups" "all" {
  count = var.verify_no_access_groups ? 1 : 0

  account_id = var.cloudflare_account_id
  max_items  = 1000
}

check "all_access_groups_are_declared" {
  assert {
    condition     = var.verify_no_access_groups ? length(data.cloudflare_zero_trust_access_groups.all[0].result) == 0 : true
    error_message = "The Cloudflare account contains Access groups. Declare and import every group in this root before applying."
  }
}

# Cloudflare exposes one Zero Trust organization per account. Provider v5 uses
# an idempotent singleton update and does not support terraform import for this
# resource. The first reviewed apply adopts the existing settings in place.
resource "cloudflare_zero_trust_organization" "shared" {
  account_id                  = var.cloudflare_account_id
  name                        = "personal-site - Cloudflare Access"
  auth_domain                 = "personal-site-bu5-pages.cloudflareaccess.com"
  allow_authenticate_via_warp = false
  is_ui_read_only             = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_identity_provider" "cloudflare" {
  account_id = var.cloudflare_account_id
  name       = "Cloudflare"
  type       = "cloudflare"
  config = {
    restrict_to_account_members = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# This account-level policy is intentionally unattached during the ownership
# migration. Workloads can adopt it after the imported Pages application and
# its two existing app-scoped policies have passed recovery testing.
resource "cloudflare_zero_trust_access_policy" "cloudflare_account_members" {
  account_id = var.cloudflare_account_id
  name       = "Cloudflare account members"
  decision   = "allow"
  include = [{
    cloudflare_account_member = {}
  }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "pages_preview" {
  account_id = var.cloudflare_account_id
  name       = "personal-site - Cloudflare Pages"
  domain     = "*.${var.pages_host}"
  type       = "self_hosted"

  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.cloudflare.id]
  auto_redirect_to_identity = true
  session_duration          = "720h"

  app_launcher_visible       = true
  enable_binding_cookie      = false
  http_only_cookie_attribute = true
  options_preflight_bypass   = false

  # Provider v5 manages application-scoped policy associations inline. Keep
  # the existing UUIDs and precedence without rewriting their rules, so import
  # cannot detach, replace, or garbage-collect them.
  policies = [
    {
      id         = local.pages_human_policy_id
      precedence = 1
    },
    {
      id         = local.pages_service_policy_id
      precedence = 2
    },
  ]

  lifecycle {
    prevent_destroy = true
  }
}
