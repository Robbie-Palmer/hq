terraform {
  required_providers {
    doppler = {
      source = "DopplerHQ/doppler"
    }
    github = {
      source = "integrations/github"
    }
  }
}

variable "project_id" {
  type = string
}

variable "doppler_project_name" {
  type = string
}

variable "doppler_project_description" {
  type = string
}

variable "repository" {
  type = string
}

variable "environments" {
  type = map(object({
    doppler_environment_name = string
    doppler_configs          = set(string)
    github_environment_name  = string
    protected_branches       = optional(bool, false)
    reviewer_usernames       = optional(set(string), [])
  }))
}

locals {
  configs = merge(flatten([
    for environment_slug, environment in var.environments : [{
      for config_name in environment.doppler_configs :
      "${environment_slug}/${config_name}" => {
        environment = environment_slug
        name        = config_name
      }
      if config_name != environment_slug
    }]
  ])...)
  reviewer_usernames = toset(flatten([
    for environment in values(var.environments) : environment.reviewer_usernames
  ]))
}

data "github_user" "reviewer" {
  for_each = local.reviewer_usernames
  username = each.key
}

resource "doppler_project" "project" {
  name        = var.doppler_project_name
  description = var.doppler_project_description

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_environment" "project" {
  for_each = var.environments

  project          = doppler_project.project.name
  slug             = each.key
  name             = each.value.doppler_environment_name
  personal_configs = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_config" "project" {
  for_each = local.configs

  project     = doppler_project.project.name
  environment = doppler_environment.project[each.value.environment].slug
  name        = each.value.name

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_environment" "project" {
  for_each = var.environments

  repository          = var.repository
  environment         = each.value.github_environment_name
  can_admins_bypass   = true
  prevent_self_review = false

  dynamic "reviewers" {
    for_each = length(each.value.reviewer_usernames) == 0 ? [] : [each.value.reviewer_usernames]

    content {
      users = [for username in reviewers.value : data.github_user.reviewer[username].id]
    }
  }

  dynamic "deployment_branch_policy" {
    for_each = each.value.protected_branches ? [true] : []

    content {
      protected_branches     = true
      custom_branch_policies = false
    }
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = length(each.value.reviewer_usernames) <= 6
      error_message = "GitHub environments support at most six required reviewers."
    }
  }
}

output "resource_ids" {
  value = {
    project_id      = var.project_id
    doppler_project = doppler_project.project.id
    doppler_environments = {
      for key, environment in doppler_environment.project : key => environment.id
    }
    github_environments = {
      for key, environment in github_repository_environment.project : key => environment.id
    }
    doppler_configs = {
      for key, config in doppler_config.project : key => config.id
    }
  }
}
