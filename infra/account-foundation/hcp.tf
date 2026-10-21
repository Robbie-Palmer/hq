locals {
  hcp_organization             = "robbie-palmer"
  account_foundation_workspace = "personal-site-account-foundation"
  hcp_projects = merge(var.hcp_projects, {
    for key, root in var.additional_roots : key => merge(root.hcp.project, { import_id = null })
  })
  hcp_roots = merge(var.hcp_roots, {
    for key, root in var.additional_roots : key => merge(root.hcp.workspace, {
      project   = key
      import_id = null
    })
  })
  hcp_project_registry_ids = concat(keys(var.hcp_projects), keys(var.additional_roots))
  hcp_root_registry_ids    = concat(keys(var.hcp_roots), keys(var.additional_roots))
  protected_hcp_projects   = { for key, project in local.hcp_projects : key => project if project.deletion_protected }
  disposable_hcp_projects  = { for key, project in local.hcp_projects : key => project if !project.deletion_protected }
  protected_hcp_roots      = { for key, root in local.hcp_roots : key => root if root.deletion_protected }
  disposable_hcp_roots     = { for key, root in local.hcp_roots : key => root if !root.deletion_protected }
  managed_hcp_projects     = merge(tfe_project.protected, tfe_project.disposable)
  managed_hcp_workspaces   = merge(tfe_workspace.protected, tfe_workspace.disposable)
}

# The state workspace is a manual seed. Reading it lets plans detect accidental
# removal or drift without granting this root a resource address that could
# rename or destroy its own state container.
data "tfe_workspace" "account_foundation_seed" {
  name         = local.account_foundation_workspace
  organization = local.hcp_organization

  lifecycle {
    precondition {
      condition     = length(distinct(local.hcp_project_registry_ids)) == length(local.hcp_project_registry_ids)
      error_message = "Additional roots must not replace an existing HCP project registry identifier."
    }

    precondition {
      condition     = length(distinct(local.hcp_root_registry_ids)) == length(local.hcp_root_registry_ids)
      error_message = "Additional roots must not replace an existing HCP root registry identifier."
    }

    precondition {
      condition     = length(distinct(local.delivery_root_ids)) == length(local.delivery_root_ids)
      error_message = "Additional roots must not replace an existing delivery root registry identifier."
    }

    precondition {
      condition     = length(distinct(local.doppler_project_ids)) == length(local.doppler_project_ids)
      error_message = "Every delivery root must use a unique Doppler project name."
    }

    precondition {
      condition     = length(distinct(local.doppler_environment_ids)) == length(local.doppler_environment_ids)
      error_message = "Every Doppler environment must have a unique project and environment identifier."
    }

    precondition {
      condition     = length(distinct(local.doppler_config_ids)) == length(local.doppler_config_ids)
      error_message = "Every Doppler config must have a unique project, environment, and config identifier."
    }

    precondition {
      condition     = length(distinct(local.github_environment_ids)) == length(local.github_environment_ids)
      error_message = "Every GitHub environment must have a unique repository and environment identifier."
    }

    precondition {
      condition     = length(distinct(local.github_branch_policy_ids)) == length(local.github_branch_policy_ids)
      error_message = "Every GitHub branch policy must have a unique repository, environment, and branch identifier."
    }

    postcondition {
      condition = (
        self.execution_mode == "local" &&
        self.auto_apply == false &&
        self.global_remote_state == false
      )
      error_message = "The manually seeded account-foundation workspace must use local execution, disable automatic apply, and disable global state access."
    }
  }
}

resource "tfe_project" "protected" {
  for_each = local.protected_hcp_projects

  name         = each.value.name
  organization = local.hcp_organization
  tags         = each.value.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "tfe_project" "disposable" {
  for_each = local.disposable_hcp_projects

  name         = each.value.name
  organization = local.hcp_organization
  tags         = each.value.tags
}

resource "tfe_workspace" "protected" {
  for_each = local.protected_hcp_roots

  name                  = each.value.workspace_name
  organization          = local.hcp_organization
  project_id            = local.managed_hcp_projects[each.value.project].id
  terraform_version     = each.value.terraform_version
  queue_all_runs        = each.value.queue_all_runs
  file_triggers_enabled = each.value.file_triggers_enabled

  lifecycle {
    prevent_destroy = true
  }
}

resource "tfe_workspace" "disposable" {
  for_each = local.disposable_hcp_roots

  name                  = each.value.workspace_name
  organization          = local.hcp_organization
  project_id            = local.managed_hcp_projects[each.value.project].id
  terraform_version     = each.value.terraform_version
  queue_all_runs        = each.value.queue_all_runs
  file_triggers_enabled = each.value.file_triggers_enabled
}

resource "tfe_workspace_settings" "managed" {
  for_each = local.hcp_roots

  workspace_id         = local.managed_hcp_workspaces[each.key].id
  execution_mode       = "local"
  auto_apply           = false
  global_remote_state  = false
  project_remote_state = false
  remote_state_consumer_ids = [
    for consumer in each.value.state_consumers :
    local.managed_hcp_workspaces[consumer].id
  ]
  tags = each.value.tags
}

check "root_projects_exist" {
  assert {
    condition = alltrue([
      for root in values(local.hcp_roots) : contains(keys(local.hcp_projects), root.project)
    ])
    error_message = "Every HCP root must reference a declared HCP project."
  }
}

check "state_consumers_exist" {
  assert {
    condition = alltrue([
      for key, root in local.hcp_roots :
      length(setsubtract(root.state_consumers, keys(local.hcp_roots))) == 0 &&
      !contains(root.state_consumers, key)
    ])
    error_message = "State consumers must reference other declared HCP roots."
  }
}

check "account_foundation_seed_is_readable" {
  assert {
    condition     = data.tfe_workspace.account_foundation_seed.name == local.account_foundation_workspace
    error_message = "The manually seeded account-foundation workspace must remain readable."
  }
}
