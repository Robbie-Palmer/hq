mock_provider "doppler" {}

mock_provider "github" {
  mock_data "github_user" {
    defaults = {
      id = 8760191
    }
  }
}

mock_provider "tfe" {
  mock_data "tfe_workspace" {
    defaults = {
      execution_mode      = "local"
      auto_apply          = false
      global_remote_state = false
    }
  }
}

variables {
  hcp_projects            = {}
  hcp_roots               = {}
  enable_existing_imports = false
  additional_roots = {
    canary = {
      hcp = {
        project = {
          name               = "Account foundation canary"
          tags               = { purpose = "canary" }
          deletion_protected = false
        }
        workspace = {
          workspace_name     = "account-foundation-canary"
          terraform_version  = "1.16.4"
          tags               = { purpose = "canary" }
          state_consumers    = []
          deletion_protected = false
        }
      }
      delivery = {
        deletion_protected = false
        imported           = false
        doppler = {
          project = {
            name        = "account-foundation-canary"
            description = "Disposable account-foundation onboarding canary"
          }
          environments = {
            ops = {
              name             = "Operations"
              personal_configs = false
              configs          = []
            }
          }
        }
        github = {
          repository = "hq"
          environments = {
            canary = {
              name                 = "account-foundation-canary"
              custom_branch_policy = true
              branch_patterns      = { main = null }
            }
          }
        }
      }
    }
  }
}

run "create_complete_canary" {
  command = apply

  assert {
    condition = (
      tfe_project.disposable["canary"].name == "Account foundation canary" &&
      tfe_workspace.disposable["canary"].name == "account-foundation-canary"
    )
    error_message = "One canary entry must create its HCP project and workspace."
  }

  assert {
    condition = (
      doppler_project.disposable["account-foundation-canary"].name == "account-foundation-canary" &&
      doppler_environment.disposable["account-foundation-canary/ops"].slug == "ops" &&
      length(doppler_config.disposable) == 0
    )
    error_message = "One canary entry must create its Doppler project and environment; Doppler creates the root config with the environment."
  }

  assert {
    condition = (
      github_repository_environment.disposable["hq/account-foundation-canary"].environment == "account-foundation-canary" &&
      github_repository_environment_deployment_policy.disposable["hq/account-foundation-canary/main"].branch_pattern == "main"
    )
    error_message = "One canary entry must create its protected GitHub delivery environment."
  }
}

run "remove_complete_canary" {
  command = apply

  variables {
    additional_roots = {}
  }

  assert {
    condition = (
      output.managed_hcp_projects == {} &&
      output.managed_hcp_workspaces == {} &&
      length(doppler_project.disposable) == 0 &&
      length(github_repository_environment.disposable) == 0
    )
    error_message = "Removing the canary entry must clean up only its disposable HCP and delivery resources."
  }
}
