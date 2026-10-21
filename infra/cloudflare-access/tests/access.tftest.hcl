mock_provider "cloudflare" {
  mock_resource "cloudflare_zero_trust_access_identity_provider" {
    defaults = {
      id = "69e998ae-23eb-45a4-b2ed-6f13bb62040b"
    }
  }

  mock_resource "cloudflare_zero_trust_access_service_token" {
    defaults = {
      client_id     = "mock-client-id"
      client_secret = null
    }
  }

  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = {
      id = "6a6fe70f-7fac-4416-8a76-914c439e4d4e"
    }
  }
}

override_resource {
  target = cloudflare_zero_trust_access_identity_provider.cloudflare
  values = {
    id = "69e998ae-23eb-45a4-b2ed-6f13bb62040b"
  }
}

override_resource {
  target = cloudflare_zero_trust_access_service_token.preview_qa_agents
  values = {
    id            = "5083f895-a6cd-430c-85c7-e422baa934de"
    client_id     = "mock-agent-client-id"
    client_secret = null
  }
}

override_resource {
  target = cloudflare_zero_trust_access_service_token.preview_qa_workflow
  values = {
    id            = "c95f960c-8f05-4d9b-a172-ea48efada399"
    client_id     = "mock-workflow-client-id"
    client_secret = null
  }
}

override_resource {
  target = cloudflare_zero_trust_access_application.pages_preview
  values = {
    id = "6a6fe70f-7fac-4416-8a76-914c439e4d4e"
  }
}

variables {
  cloudflare_account_id   = "dcd7cd68dd892d610267ded6b1af567b"
  verify_no_access_groups = false
}

run "shared_access_ownership" {
  command = plan

  assert {
    condition = (
      cloudflare_zero_trust_organization.shared.name == "personal-site - Cloudflare Access" &&
      cloudflare_zero_trust_organization.shared.auth_domain == "personal-site-bu5-pages.cloudflareaccess.com" &&
      cloudflare_zero_trust_organization.shared.is_ui_read_only == false
    )
    error_message = "The root must preserve the current Zero Trust organization settings."
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_identity_provider.cloudflare.type == "cloudflare" &&
      cloudflare_zero_trust_access_identity_provider.cloudflare.config.restrict_to_account_members
    )
    error_message = "The shared identity provider must restrict authentication to Cloudflare account members."
  }

  assert {
    condition = toset([
      for policy in cloudflare_zero_trust_access_application.pages_preview.policies : policy.id
      ]) == toset([
      "c275b7a3-6095-4b53-a5df-f7121ce84e38",
      "4b19cc49-b3fb-4c56-a0e6-fd88b3740743",
    ])
    error_message = "The Pages application must keep both existing app-scoped policy IDs."
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_service_token.preview_qa_agents.duration == "forever" &&
      cloudflare_zero_trust_access_service_token.preview_qa_workflow.duration == "forever"
    )
    error_message = "Importing the preview identities must not add an expiry or trigger rotation."
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_policy.cloudflare_account_members.decision == "allow" &&
      length(cloudflare_zero_trust_access_policy.cloudflare_account_members.include) == 1
    )
    error_message = "The root must declare one reusable Cloudflare account-member policy."
  }
}
