locals {
  # Keep this declaration free of credentials and secret values. Workload
  # values continue to move from Doppler to GitHub through the sync script.
  root_delivery_registry = {
    cloudflare-access = {
      doppler = {
        project = {
          name        = "cloudflare-access"
          description = "Provider-wide Cloudflare Access infrastructure"
        }
        environments = {
          ops = {
            name             = "Operations"
            personal_configs = false
            configs = {
              plan = {
                name = "ops_plan"
              }
              drift = {
                name = "ops_drift"
              }
              apply = {
                name = "ops_apply"
              }
            }
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          plan = {
            name                 = "production-cloudflare-access-plan"
            can_admins_bypass    = true
            prevent_self_review  = false
            reviewer_usernames   = ["Robbie-Palmer"]
            protected_branches   = false
            custom_branch_policy = false
            branch_patterns      = []
          }
          drift = {
            name                 = "production-cloudflare-access-drift"
            can_admins_bypass    = true
            prevent_self_review  = false
            reviewer_usernames   = []
            protected_branches   = false
            custom_branch_policy = true
            branch_patterns      = ["main"]
          }
          apply = {
            name                 = "production-cloudflare-access"
            can_admins_bypass    = true
            prevent_self_review  = false
            reviewer_usernames   = ["Robbie-Palmer"]
            protected_branches   = false
            custom_branch_policy = true
            branch_patterns      = ["main"]
          }
        }
      }
    }
  }

  doppler_projects = {
    for root_id, root in local.root_delivery_registry : root.doppler.project.name => {
      root_id     = root_id
      name        = root.doppler.project.name
      description = root.doppler.project.description
    }
  }

  doppler_environments = merge([
    for root_id, root in local.root_delivery_registry : {
      for environment_slug, environment in root.doppler.environments :
      "${root.doppler.project.name}/${environment_slug}" => {
        root_id          = root_id
        project          = root.doppler.project.name
        slug             = environment_slug
        name             = environment.name
        personal_configs = environment.personal_configs
      }
    }
  ]...)

  doppler_configs = merge(flatten([
    for root_id, root in local.root_delivery_registry : [
      for environment_slug, environment in root.doppler.environments : {
        for config_id, config in environment.configs :
        "${root.doppler.project.name}/${environment_slug}/${config.name}" => {
          root_id     = root_id
          config_id   = config_id
          project     = root.doppler.project.name
          environment = environment_slug
          name        = config.name
        }
      }
    ]
  ])...)

  github_environments = merge([
    for root_id, root in local.root_delivery_registry : {
      for purpose, environment in root.github.environments :
      "${root.github.repository}/${environment.name}" => merge(environment, {
        root_id    = root_id
        purpose    = purpose
        repository = root.github.repository
      })
    }
  ]...)

  github_branch_policies = merge([
    for environment_key, environment in local.github_environments : {
      for branch_pattern in environment.branch_patterns :
      "${environment_key}/${branch_pattern}" => {
        environment_key = environment_key
        repository      = environment.repository
        environment     = environment.name
        branch_pattern  = branch_pattern
      }
    }
  ]...)

  github_reviewer_usernames = toset(flatten([
    for environment in values(local.github_environments) : environment.reviewer_usernames
  ]))
}

data "github_user" "reviewer" {
  for_each = local.github_reviewer_usernames

  username = each.key
}

resource "doppler_project" "managed" {
  for_each = local.doppler_projects

  name        = each.value.name
  description = each.value.description

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_environment" "managed" {
  for_each = local.doppler_environments

  project          = doppler_project.managed[each.value.project].name
  slug             = each.value.slug
  name             = each.value.name
  personal_configs = each.value.personal_configs

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_config" "managed" {
  for_each = local.doppler_configs

  project     = doppler_project.managed[each.value.project].name
  environment = doppler_environment.managed["${each.value.project}/${each.value.environment}"].slug
  name        = each.value.name

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_environment" "managed" {
  for_each = local.github_environments

  repository          = each.value.repository
  environment         = each.value.name
  can_admins_bypass   = each.value.can_admins_bypass
  prevent_self_review = each.value.prevent_self_review

  dynamic "reviewers" {
    for_each = length(each.value.reviewer_usernames) == 0 ? [] : [each.value.reviewer_usernames]

    content {
      users = [for username in reviewers.value : data.github_user.reviewer[username].id]
    }
  }

  dynamic "deployment_branch_policy" {
    for_each = each.value.protected_branches || each.value.custom_branch_policy ? [each.value] : []

    content {
      protected_branches     = deployment_branch_policy.value.protected_branches
      custom_branch_policies = deployment_branch_policy.value.custom_branch_policy
    }
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = length(each.value.reviewer_usernames) <= 6
      error_message = "GitHub environments support at most six required reviewers."
    }

    precondition {
      condition     = each.value.custom_branch_policy == (length(each.value.branch_patterns) > 0)
      error_message = "A custom branch policy must declare at least one branch pattern, and branch patterns require a custom policy."
    }

    precondition {
      condition     = !(each.value.protected_branches && each.value.custom_branch_policy)
      error_message = "GitHub protected-branch and custom-branch deployment policies are mutually exclusive."
    }
  }
}

resource "github_repository_environment_deployment_policy" "managed" {
  for_each = local.github_branch_policies

  repository     = each.value.repository
  environment    = github_repository_environment.managed[each.value.environment_key].environment
  branch_pattern = each.value.branch_pattern
}
