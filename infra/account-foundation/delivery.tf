locals {
  # Keep this declaration free of credentials and secret values. Workload
  # values continue to move from Doppler to GitHub through the sync script.
  github_environment_defaults = {
    can_admins_bypass    = true
    prevent_self_review  = false
    reviewer_usernames   = []
    protected_branches   = false
    custom_branch_policy = false
    branch_patterns      = {}
  }

  declared_delivery_registry = {
    ai-review = {
      deletion_protected = true
      imported           = true
      doppler = {
        project = {
          name        = "ai-review"
          description = "Standalone stateful Workers AI code review service"
        }
        environments = {
          dev = {
            name             = "Development"
            personal_configs = true
            configs          = ["dev", "dev_personal"]
          }
          stg = {
            name             = "Staging"
            personal_configs = false
            configs          = ["stg"]
          }
          prd = {
            name             = "Production"
            personal_configs = false
            configs          = ["prd"]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          production = {
            name               = "production-ai-review"
            protected_branches = true
          }
        }
      }
    }
    homelab = {
      deletion_protected = true
      imported           = true
      doppler = {
        project = {
          name        = "homelab"
          description = "Secrets and configuration for the private homelab"
        }
        environments = {
          dev = {
            name             = "Development"
            personal_configs = true
            configs          = ["dev", "dev_personal"]
          }
          stg = {
            name             = "Staging"
            personal_configs = false
            configs          = ["stg"]
          }
          prd = {
            name             = "Production"
            personal_configs = false
            configs = [
              "prd",
              "prd_personal_archive_backup",
              "prd_personal_archive_infra",
              "prd_remote_development",
              "prd_remote_development_backup",
              "prd_remote_development_cluster",
              "prd_remote_development_host",
              "prd_remote_development_infra",
              "prd_remote_development_observability",
              "prd_vector_development",
            ]
          }
          prd_tailnet_values = {
            name             = "Production Tailnet Values"
            personal_configs = false
            configs = [
              "prd_tailnet_values",
              "prd_tailnet_values_infra",
              "prd_tailnet_values_infra_plan",
            ]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          remote-development-apply = {
            name               = "production-remote-development-infra"
            reviewer_usernames = ["Robbie-Palmer"]
          }
          remote-development-plan = {
            name = "production-remote-development-infra-plan"
          }
          tailnet-apply = {
            name                 = "production-tailnet-infra"
            reviewer_usernames   = ["Robbie-Palmer"]
            custom_branch_policy = true
            branch_patterns      = { main = null }
            imported             = false
          }
          tailnet-drift = {
            name                 = "production-tailnet-infra-drift"
            custom_branch_policy = true
            branch_patterns      = { main = null }
            imported             = false
          }
          tailnet-plan = {
            name               = "production-tailnet-infra-plan"
            reviewer_usernames = ["Robbie-Palmer"]
            imported           = false
          }
        }
      }
    }
    personal-site = {
      deletion_protected = true
      imported           = true
      doppler = {
        project = {
          name        = "personal-site"
          description = "Secrets and configuration for the personal-site monorepo"
        }
        environments = {
          dev = {
            name             = "Development"
            personal_configs = true
            configs = [
              "dev",
              "dev_personal",
              "dev_agent",
              "dev_bootstrap_infra",
              "dev_infra",
              "dev_ml_pipelines",
              "dev_pages_env",
              "dev_recipe_api",
            ]
          }
          stg = {
            name             = "Staging"
            personal_configs = false
            configs          = ["stg", "stg_pages_env", "stg_recipe_api", "stg_site_ui"]
          }
          prd = {
            name             = "Production"
            personal_configs = false
            configs = [
              "prd",
              "prd_bootstrap_infra",
              "prd_bootstrap_plan",
              "prd_ci_repo",
              "prd_database_backup",
              "prd_infra",
              "prd_pages_env",
              "prd_recipe_api",
              "prd_recipe_ingest",
              "prd_site_ui",
            ]
          }
          ops = {
            name             = "Operations"
            personal_configs = false
            # The account-foundation seed configs stay outside this registry.
            configs = ["ops", "ops_preview_agent_access"]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          copilot = {
            name = "copilot"
          }
          preview-agent-access = {
            name                 = "preview-agent-access"
            custom_branch_policy = true
            branch_patterns      = { main = "57426226" }
          }
          preview-recipe-api = {
            name = "preview-recipe-api"
          }
          preview-site-ui = {
            name = "preview-site-ui"
          }
          production-ci = {
            name = "production-ci"
          }
          production-database-backup = {
            name                 = "production-database-backup"
            custom_branch_policy = true
            branch_patterns      = { main = "55072267" }
          }
          production-infra = {
            name = "production-infra"
          }
          production-infra-bootstrap = {
            name = "production-infra-bootstrap"
          }
          production-infra-bootstrap-plan = {
            name               = "production-infra-bootstrap-plan"
            reviewer_usernames = ["Robbie-Palmer"]
          }
          production-recipe-api = {
            name = "production-recipe-api"
          }
          production-recipe-ingest = {
            name = "production-recipe-ingest"
          }
          production-site-ui = {
            name = "production-site-ui"
          }
        }
      }
    }
    work-graph = {
      deletion_protected = true
      imported           = true
      doppler = {
        project = {
          name        = "work-graph"
          description = "Work Graph infrastructure, runtime, and agent credentials"
        }
        environments = {
          dev = {
            name             = "Development"
            personal_configs = true
            configs          = ["dev", "dev_personal"]
          }
          stg = {
            name             = "Staging"
            personal_configs = false
            configs          = ["stg"]
          }
          prd = {
            name             = "Production"
            personal_configs = false
            configs          = ["prd", "prd_work_graph", "prd_work_graph_backup", "prd_work_graph_infra"]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          production = {
            name               = "production-work-graph"
            protected_branches = true
          }
          backup = {
            name               = "production-work-graph-backup"
            protected_branches = true
          }
          infrastructure = {
            name               = "production-work-graph-infra"
            protected_branches = true
          }
        }
      }
    }
    cloudflare-access = {
      deletion_protected = true
      imported           = false
      doppler = {
        project = {
          name        = "cloudflare-access"
          description = "Provider-wide Cloudflare Access infrastructure"
        }
        environments = {
          ops = {
            name             = "Operations"
            personal_configs = false
            configs          = ["ops_plan", "ops_drift", "ops_apply"]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          plan = {
            name               = "production-cloudflare-access-plan"
            reviewer_usernames = ["Robbie-Palmer"]
          }
          drift = {
            name                 = "production-cloudflare-access-drift"
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
          apply = {
            name                 = "production-cloudflare-access"
            reviewer_usernames   = ["Robbie-Palmer"]
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
        }
      }
    }
    cloudflare-token-bootstrap = {
      deletion_protected = true
      imported           = false
      doppler = {
        project = {
          name        = "cloudflare-token-bootstrap"
          description = "Cloudflare account-owned API token provisioning authority"
        }
        environments = {
          ops = {
            name             = "Operations"
            personal_configs = false
            configs          = ["ops_provisioner"]
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          provision = {
            name                 = "production-cloudflare-token-bootstrap"
            can_admins_bypass    = false
            reviewer_usernames   = ["Robbie-Palmer"]
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
        }
      }
    }
    personal-finance = {
      deletion_protected = true
      imported           = false
      doppler = {
        project = {
          name        = "personal-finance"
          description = "Personal Finance infrastructure delivery credentials"
        }
        environments = {
          ops = {
            name             = "Pull request plans"
            personal_configs = false
            configs          = []
          }
          drift = {
            name             = "Drift checks"
            personal_configs = false
            configs          = []
          }
          apply = {
            name             = "Production applies"
            personal_configs = false
            configs          = []
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          plan = {
            name               = "production-personal-finance-plan"
            reviewer_usernames = ["Robbie-Palmer"]
          }
          drift = {
            name                 = "production-personal-finance-drift"
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
          apply = {
            name                 = "production-personal-finance"
            reviewer_usernames   = ["Robbie-Palmer"]
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
        }
      }
    }
  }

  delivery_registry_entries = concat(
    [for root_id, root in local.declared_delivery_registry : { root_id = root_id, root = root }],
    [for root_id, root in var.additional_roots : { root_id = root_id, root = root.delivery }],
  )
  delivery_root_ids = [for entry in local.delivery_registry_entries : entry.root_id]
  doppler_project_ids = [
    for entry in local.delivery_registry_entries : entry.root.doppler.project.name
  ]
  doppler_environment_ids = flatten([
    for entry in local.delivery_registry_entries : [
      for environment_slug in keys(entry.root.doppler.environments) :
      "${entry.root.doppler.project.name}/${environment_slug}"
    ]
  ])
  doppler_config_ids = flatten([
    for entry in local.delivery_registry_entries : flatten([
      for environment_slug, environment in entry.root.doppler.environments : [
        for config_name in environment.configs :
        "${entry.root.doppler.project.name}/${environment_slug}/${config_name}"
      ]
    ])
  ])
  cloudflare_token_bootstrap_config_id = "cloudflare-token-bootstrap/ops/ops_provisioner"
  github_environment_ids = flatten([
    for entry in local.delivery_registry_entries : [
      for environment in values(entry.root.github.environments) :
      "${entry.root.github.repository}/${environment.name}"
    ]
  ])
  github_branch_policy_ids = flatten([
    for entry in local.delivery_registry_entries : flatten([
      for environment in values(entry.root.github.environments) : [
        for branch_pattern in keys(try(environment.branch_patterns, {})) :
        "${entry.root.github.repository}/${environment.name}/${branch_pattern}"
      ]
    ])
  ])

  root_delivery_registry = merge([
    for entry in local.delivery_registry_entries : {
      (entry.root_id) = entry.root
    }
  ]...)

  doppler_projects = merge([
    for root_id, root in local.root_delivery_registry : {
      (root.doppler.project.name) = {
        root_id     = root_id
        name        = root.doppler.project.name
        description = root.doppler.project.description
        imported    = root.imported && var.enable_existing_imports
      }
    }
  ]...)

  doppler_environments = merge([
    for root_id, root in local.root_delivery_registry : {
      for environment_slug, environment in root.doppler.environments :
      "${root.doppler.project.name}/${environment_slug}" => {
        root_id          = root_id
        project          = root.doppler.project.name
        slug             = environment_slug
        name             = environment.name
        personal_configs = environment.personal_configs
        imported         = root.imported && var.enable_existing_imports
      }
    }
  ]...)

  doppler_configs = merge(flatten([
    for root_id, root in local.root_delivery_registry : [
      for environment_slug, environment in root.doppler.environments : {
        for config_name in environment.configs :
        "${root.doppler.project.name}/${environment_slug}/${config_name}" => {
          root_id     = root_id
          project     = root.doppler.project.name
          environment = environment_slug
          name        = config_name
          imported = (
            root.imported ||
            "${root.doppler.project.name}/${environment_slug}/${config_name}" == local.cloudflare_token_bootstrap_config_id
          ) && var.enable_existing_imports
        }
      }
    ]
  ])...)

  github_environments = merge([
    for root_id, root in local.root_delivery_registry : {
      for purpose, environment in root.github.environments :
      "${root.github.repository}/${environment.name}" => merge(local.github_environment_defaults, environment, {
        root_id    = root_id
        purpose    = purpose
        repository = root.github.repository
        imported   = try(environment.imported, root.imported) && var.enable_existing_imports
      })
    }
  ]...)

  github_branch_policies = merge([
    for environment_key, environment in local.github_environments : {
      for branch_pattern, import_id in environment.branch_patterns :
      "${environment_key}/${branch_pattern}" => {
        root_id         = environment.root_id
        environment_key = environment_key
        repository      = environment.repository
        environment     = environment.name
        branch_pattern  = branch_pattern
        import_id       = import_id
        imported        = environment.imported
      }
    }
  ]...)

  github_reviewer_usernames = toset(flatten([
    for environment in values(local.github_environments) : environment.reviewer_usernames
  ]))

  protected_delivery_root_ids = toset([
    for root_id, root in local.root_delivery_registry : root_id if root.deletion_protected
  ])
  disposable_delivery_root_ids = toset([
    for root_id, root in local.root_delivery_registry : root_id if !root.deletion_protected
  ])

  protected_doppler_projects     = { for key, value in local.doppler_projects : key => value if contains(local.protected_delivery_root_ids, value.root_id) }
  disposable_doppler_projects    = { for key, value in local.doppler_projects : key => value if contains(local.disposable_delivery_root_ids, value.root_id) }
  protected_doppler_environments = { for key, value in local.doppler_environments : key => value if contains(local.protected_delivery_root_ids, value.root_id) }
  disposable_doppler_environments = {
    for key, value in local.doppler_environments : key => value if contains(local.disposable_delivery_root_ids, value.root_id)
  }
  protected_doppler_configs  = { for key, value in local.doppler_configs : key => value if contains(local.protected_delivery_root_ids, value.root_id) }
  disposable_doppler_configs = { for key, value in local.doppler_configs : key => value if contains(local.disposable_delivery_root_ids, value.root_id) }
  protected_github_environments = {
    for key, value in local.github_environments : key => value if contains(local.protected_delivery_root_ids, value.root_id)
  }
  disposable_github_environments = {
    for key, value in local.github_environments : key => value if contains(local.disposable_delivery_root_ids, value.root_id)
  }
  protected_github_branch_policies = {
    for key, value in local.github_branch_policies : key => value if contains(local.protected_delivery_root_ids, value.root_id)
  }
  disposable_github_branch_policies = {
    for key, value in local.github_branch_policies : key => value if contains(local.disposable_delivery_root_ids, value.root_id)
  }

  managed_doppler_projects     = merge(doppler_project.managed, doppler_project.disposable)
  managed_doppler_environments = merge(doppler_environment.managed, doppler_environment.disposable)
  managed_github_environments  = merge(github_repository_environment.managed, github_repository_environment.disposable)

}

data "github_user" "reviewer" {
  for_each = local.github_reviewer_usernames

  username = each.key
}

resource "doppler_project" "managed" {
  for_each = local.protected_doppler_projects

  name        = each.value.name
  description = each.value.description

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_project" "disposable" {
  for_each = local.disposable_doppler_projects

  name        = each.value.name
  description = each.value.description
}

resource "doppler_environment" "managed" {
  for_each = local.protected_doppler_environments

  project          = local.managed_doppler_projects[each.value.project].name
  slug             = each.value.slug
  name             = each.value.name
  personal_configs = each.value.personal_configs

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_environment" "disposable" {
  for_each = local.disposable_doppler_environments

  project          = local.managed_doppler_projects[each.value.project].name
  slug             = each.value.slug
  name             = each.value.name
  personal_configs = each.value.personal_configs
}

resource "doppler_config" "managed" {
  for_each = local.protected_doppler_configs

  project     = local.managed_doppler_projects[each.value.project].name
  environment = local.managed_doppler_environments["${each.value.project}/${each.value.environment}"].slug
  name        = each.value.name

  lifecycle {
    prevent_destroy = true
  }
}

resource "doppler_config" "disposable" {
  for_each = local.disposable_doppler_configs

  project     = local.managed_doppler_projects[each.value.project].name
  environment = local.managed_doppler_environments["${each.value.project}/${each.value.environment}"].slug
  name        = each.value.name
}

resource "github_repository_environment" "managed" {
  for_each = local.protected_github_environments

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

resource "github_repository_environment" "disposable" {
  for_each = local.disposable_github_environments

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
  for_each = local.protected_github_branch_policies

  repository     = each.value.repository
  environment    = local.managed_github_environments[each.value.environment_key].environment
  branch_pattern = each.value.branch_pattern
}

resource "github_repository_environment_deployment_policy" "disposable" {
  for_each = local.disposable_github_branch_policies

  repository     = each.value.repository
  environment    = local.managed_github_environments[each.value.environment_key].environment
  branch_pattern = each.value.branch_pattern
}
