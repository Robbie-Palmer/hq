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

  mock_resource "tfe_project" {
    defaults = {
      id = "prj-default"
    }
  }

  mock_resource "tfe_workspace" {
    defaults = {
      id = "ws-personal-finance"
    }
  }
}

variables {
  enable_existing_imports = false

  hcp_projects = {
    default = {
      name               = "Default Project"
      tags               = {}
      deletion_protected = true
    }
  }

  hcp_roots = {
    personal-finance = {
      workspace_name    = "personal-site-personal-finance"
      project           = "default"
      terraform_version = "1.16.4"
      tags              = { project = "personal-finance-app" }
      state_consumers   = []
    }
  }
}

run "create_personal_finance_foundation" {
  command = apply

  assert {
    condition = (
      tfe_workspace.protected["personal-finance"].name == "personal-site-personal-finance" &&
      tfe_workspace.protected["personal-finance"].terraform_version == "1.16.4" &&
      tfe_workspace.protected["personal-finance"].project_id == "prj-default"
    )
    error_message = "Account foundation must create the Personal Finance workspace in the existing free-tier project."
  }

  assert {
    condition = (
      tfe_workspace_settings.managed["personal-finance"].execution_mode == "local" &&
      tfe_workspace_settings.managed["personal-finance"].auto_apply == false &&
      tfe_workspace_settings.managed["personal-finance"].global_remote_state == false &&
      tfe_workspace_settings.managed["personal-finance"].project_remote_state == false &&
      length(tfe_workspace_settings.managed["personal-finance"].remote_state_consumer_ids) == 0
    )
    error_message = "The Personal Finance workspace must use local execution, manual apply, and private remote state."
  }

  assert {
    condition = (
      length(tfe_workspace_settings.managed["personal-finance"].tags) == 1 &&
      lookup(tfe_workspace_settings.managed["personal-finance"].tags, "project", "") == "personal-finance-app"
    )
    error_message = "The Personal Finance workspace must retain its project registry tag."
  }
}
