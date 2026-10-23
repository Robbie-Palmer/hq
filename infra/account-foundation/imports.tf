import {
  for_each = {
    for key, project in local.protected_hcp_projects : key => project
    if project.import_id != null
  }

  to = tfe_project.protected[each.key]
  id = each.value.import_id
}

import {
  for_each = {
    for key, project in local.disposable_hcp_projects : key => project
    if project.import_id != null
  }

  to = tfe_project.disposable[each.key]
  id = each.value.import_id
}

import {
  for_each = {
    for key, root in local.protected_hcp_roots : key => root
    if root.import_id != null
  }

  to = tfe_workspace.protected[each.key]
  id = each.value.import_id
}

import {
  for_each = {
    for key, root in local.disposable_hcp_roots : key => root
    if root.import_id != null
  }

  to = tfe_workspace.disposable[each.key]
  id = each.value.import_id
}

import {
  for_each = {
    for key, root in local.hcp_roots : key => root
    if root.import_id != null
  }

  to = tfe_workspace_settings.managed[each.key]
  id = each.value.import_id
}

import {
  for_each = {
    for key, project in local.protected_doppler_projects : key => project
    if project.imported
  }

  to = doppler_project.managed[each.key]
  id = each.value.name
}

import {
  for_each = {
    for key, environment in local.protected_doppler_environments : key => environment
    if environment.imported
  }

  to = doppler_environment.managed[each.key]
  id = "${each.value.project}.${each.value.slug}"
}

import {
  for_each = {
    for key, config in local.protected_doppler_configs : key => config
    if config.imported
  }

  to = doppler_config.managed[each.key]
  id = "${each.value.project}.${each.value.environment}.${each.value.name}"
}

import {
  for_each = {
    for key, environment in local.protected_github_environments : key => environment
    if environment.imported
  }

  to = github_repository_environment.managed[each.key]
  id = "${each.value.repository}:${each.value.name}"
}

import {
  for_each = {
    for key, policy in local.protected_github_branch_policies : key => policy
    if policy.imported && policy.import_id != null
  }

  to = github_repository_environment_deployment_policy.managed[each.key]
  id = "${each.value.repository}:${each.value.environment}:${each.value.import_id}"
}
