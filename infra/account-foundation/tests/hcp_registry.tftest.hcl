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
      id                  = "ws-account-foundation-seed"
      execution_mode      = "local"
      auto_apply          = false
      global_remote_state = false
    }
  }

  mock_resource "tfe_project" {
    defaults = {
      id = "prj-canary"
    }
  }

  mock_resource "tfe_workspace" {
    defaults = {
      id = "ws-canary"
    }
  }
}

override_resource {
  target = tfe_workspace.disposable["canary-reader"]
  values = { id = "ws-canary-reader" }
}

variables {
  hcp_projects = {
    canary = {
      name               = "Account foundation canary"
      tags               = { purpose = "canary" }
      deletion_protected = false
    }
  }

  hcp_roots = {
    canary = {
      workspace_name     = "account-foundation-canary"
      project            = "canary"
      terraform_version  = "1.16.4"
      tags               = { purpose = "canary" }
      state_consumers    = ["canary-reader"]
      deletion_protected = false
    }
    canary-reader = {
      workspace_name     = "account-foundation-canary-reader"
      project            = "canary"
      terraform_version  = "1.16.4"
      tags               = { purpose = "canary" }
      state_consumers    = []
      deletion_protected = false
    }
  }
}

run "create_canary" {
  command = apply

  assert {
    condition     = tfe_workspace.disposable["canary"].name == "account-foundation-canary"
    error_message = "The canary registry entry did not create its workspace."
  }

  assert {
    condition = (
      tfe_workspace_settings.managed["canary"].execution_mode == "local" &&
      tfe_workspace_settings.managed["canary"].auto_apply == false &&
      tfe_workspace_settings.managed["canary"].global_remote_state == false &&
      tfe_workspace_settings.managed["canary"].project_remote_state == false &&
      tfe_workspace_settings.managed["canary"].remote_state_consumer_ids == toset(["ws-canary-reader"]) &&
      length(tfe_workspace_settings.managed["canary-reader"].remote_state_consumer_ids) == 0
    )
    error_message = "The canary workspace must use local execution, manual apply, and explicit state consumers."
  }

  assert {
    condition = (
      length(tfe_workspace_settings.managed["canary"].tags) == 1 &&
      lookup(tfe_workspace_settings.managed["canary"].tags, "purpose", "") == "canary"
    )
    error_message = "The canary workspace must receive its declared tags."
  }
}

run "remove_canary" {
  command = apply

  variables {
    hcp_roots = {}
  }

  assert {
    condition     = output.managed_hcp_workspaces == {}
    error_message = "Removing the disposable canary entry must remove only its workspace resources."
  }
}

run "reject_managed_seed" {
  command = plan

  variables {
    hcp_roots = {
      account-foundation = {
        workspace_name     = "personal-site-account-foundation"
        project            = "canary"
        terraform_version  = "1.16.4"
        tags               = {}
        state_consumers    = []
        deletion_protected = true
      }
    }
  }

  expect_failures = [var.hcp_roots]
}
