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
    for key, root in var.hcp_roots : key => root
    if root.import_id != null
  }

  to = tfe_workspace_settings.managed[each.key]
  id = each.value.import_id
}
