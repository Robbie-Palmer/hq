mock_provider "cloudflare" {}
mock_provider "doppler" {}
mock_provider "github" {
  mock_data "github_user" {
    defaults = { id = 8760191 }
  }
}
mock_provider "neon" {}
mock_provider "posthog" {}
mock_provider "tfe" {}

variables {
  state_scope         = "bootstrap"
  deletion_protection = false
  resolved_profile    = jsondecode(file("../examples/minimal-bootstrap/infrastructure-profile.json"))
  terraform_state = {
    organization      = "example"
    project_name      = "Platform bootstrap canary"
    workspace_name    = "platform-bootstrap-canary"
    terraform_version = "1.16.4"
    tags              = { purpose = "disposable-bootstrap-proof" }
  }
  delivery = {
    doppler_project_name        = "platform-bootstrap-canary"
    doppler_project_description = "Disposable platform bootstrap proof"
    repository                  = "hq"
    environments = {
      preview = {
        doppler_environment_name = "Preview"
        doppler_configs          = ["preview"]
        github_environment_name  = "platform-bootstrap-canary-preview"
        reviewer_usernames       = ["reviewer"]
      }
      apply = {
        doppler_environment_name = "Apply"
        doppler_configs          = ["apply"]
        github_environment_name  = "platform-bootstrap-canary-apply"
        protected_branches       = true
      }
    }
  }
}

run "create_disposable_foundation" {
  command = apply

  assert {
    condition = (
      !output.deletion_protection &&
      output.selected_capabilities == toset([
        "delivery.ci",
        "infrastructure.state-backend",
      ]) &&
      output.resource_ownership.terraform_workspace != null &&
      output.resource_ownership.delivery != null
    )
    error_message = "The profile must create only its disposable HCP, Doppler, and GitHub foundation in bootstrap state."
  }
}

run "reapply_disposable_foundation" {
  command = apply

  assert {
    condition = (
      output.resource_ownership.terraform_workspace != null &&
      output.resource_ownership.delivery != null
    )
    error_message = "Reapplying the unchanged bootstrap profile must preserve its resource identities."
  }
}

run "remove_disposable_foundation" {
  command = apply

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "platform-bootstrap-canary"
        name = "Platform bootstrap canary"
      }
      selections = []
    }
    terraform_state = null
    delivery        = null
  }

  assert {
    condition = (
      length(output.selected_capabilities) == 0 &&
      output.resource_ownership.terraform_workspace == null &&
      output.resource_ownership.delivery == null
    )
    error_message = "Removing the profile selections must clean up every disposable foundation resource."
  }
}
