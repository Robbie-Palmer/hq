# Cloudflare Pages creates the preview Access application when preview
# protection is enabled in the dashboard. Import that generated application so
# Terraform can configure its login method without replacing the Pages-aware
# wildcard application.
resource "cloudflare_zero_trust_access_application" "pages_preview" {
  account_id = var.cloudflare_account_id
  name       = "${var.project_name} - Cloudflare Pages"
  domain     = "*.${var.cf_pages_host}"
  type       = "self_hosted"

  allowed_idps              = [var.cloudflare_account_identity_provider_id]
  auto_redirect_to_identity = true
  session_duration          = "720h"

  allow_authenticate_via_warp = false
  app_launcher_visible        = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  options_preflight_bypass    = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_zero_trust_access_application.pages_preview
  id = "${var.cloudflare_account_id}/${var.cloudflare_pages_preview_access_application_id}"
}

resource "cloudflare_zero_trust_access_service_token" "preview_qa_agents" {
  account_id = var.cloudflare_account_id
  name       = "personal-site-preview-qa-agents"
  # Expiry renewal does not rotate the underlying secret. Keep the narrowly
  # scoped identity stable and rotate its secret independently with overlap.
  duration = "forever"

  lifecycle {
    create_before_destroy = true
  }
}

# Preview test requests pass through PR-controlled Pages Functions. Give the
# workflow a separate identity whose secret is rotated before and after every
# serialized run, so the long-lived coding-agent credential never reaches PR
# code.
resource "cloudflare_zero_trust_access_service_token" "preview_qa_workflow" {
  account_id = var.cloudflare_account_id
  name       = "personal-site-preview-qa-workflow"
  duration   = "forever"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "preview_qa_agents" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.pages_preview.id
  name           = "Coding agents and preview QA"
  decision       = "non_identity"
  # The existing human allow policy is precedence 1.
  precedence = 2

  include {
    service_token = [
      cloudflare_zero_trust_access_service_token.preview_qa_agents.id,
      cloudflare_zero_trust_access_service_token.preview_qa_workflow.id,
    ]
  }
}
