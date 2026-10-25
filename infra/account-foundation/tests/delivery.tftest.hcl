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
}

run "cloudflare_access_delivery_boundaries" {
  command = plan

  assert {
    condition     = doppler_project.managed["cloudflare-access"].name == "cloudflare-access"
    error_message = "The root must have its own Doppler project."
  }

  assert {
    condition     = doppler_environment.managed["cloudflare-access/ops"].slug == "ops"
    error_message = "The root must have an operations environment."
  }

  assert {
    condition = toset([
      for config in values(doppler_config.managed) :
      "${config.project}/${config.environment}/${config.name}"
      if config.project == "cloudflare-access"
      ]) == toset([
      "cloudflare-access/ops/ops_plan",
      "cloudflare-access/ops/ops_drift",
      "cloudflare-access/ops/ops_apply",
    ])
    error_message = "The root must separate plan, drift, and apply configs."
  }

  assert {
    condition = length([
      for environment in values(github_repository_environment.managed) : environment
      if startswith(environment.environment, "production-cloudflare-access")
    ]) == 3
    error_message = "The root must have plan, drift, and apply GitHub environments."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-cloudflare-access-plan"].reviewers[0].users == toset([8760191])
    error_message = "The plan environment must require the declared reviewer."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-cloudflare-access"].reviewers[0].users == toset([8760191])
    error_message = "The apply environment must require the declared reviewer."
  }

  assert {
    condition     = length(github_repository_environment.managed["hq/production-cloudflare-access-drift"].reviewers) == 0
    error_message = "The read-only drift environment must run without a reviewer gate."
  }

  assert {
    condition = toset([
      for policy in values(github_repository_environment_deployment_policy.managed) :
      "${policy.environment}/${policy.branch_pattern}"
      if startswith(policy.environment, "production-cloudflare-access")
      ]) == toset([
      "production-cloudflare-access-drift/main",
      "production-cloudflare-access/main",
    ])
    error_message = "Drift and apply must be restricted to the main branch."
  }

  assert {
    condition = length([
      for policy in values(github_repository_environment_deployment_policy.managed) : policy
      if startswith(policy.environment, "production-cloudflare-access")
    ]) == 2
    error_message = "Only the drift and apply environments may use custom branch policies."
  }

  assert {
    condition = alltrue([
      github_repository_environment.managed["hq/production-cloudflare-access-drift"].deployment_branch_policy[0].custom_branch_policies,
      github_repository_environment.managed["hq/production-cloudflare-access"].deployment_branch_policy[0].custom_branch_policies,
    ])
    error_message = "Drift and apply must enable custom branch policies."
  }
}

run "homelab_tailnet_delivery_boundaries" {
  command = plan

  assert {
    condition = (
      doppler_environment.managed["homelab/prd_tailnet_values"].slug == "prd_tailnet_values" &&
      doppler_environment.managed["homelab/prd_tailnet_values"].name == "Production Tailnet Values" &&
      !doppler_environment.managed["homelab/prd_tailnet_values"].personal_configs
    )
    error_message = "Tailnet delivery must use its dedicated non-personal Doppler environment."
  }

  assert {
    condition = toset([
      for config in values(doppler_config.managed) :
      "${config.project}/${config.environment}/${config.name}"
      if startswith(config.name, "prd_tailnet")
      ]) == toset([
      "homelab/prd_tailnet_values/prd_tailnet_values",
      "homelab/prd_tailnet_values/prd_tailnet_values_infra",
      "homelab/prd_tailnet_values/prd_tailnet_values_infra_plan",
    ])
    error_message = "Tailnet delivery must declare the shared values, read-only plan, and write apply Doppler configs."
  }

  assert {
    condition = length([
      for environment in values(github_repository_environment.managed) : environment
      if startswith(environment.environment, "production-tailnet-infra")
    ]) == 3
    error_message = "Tailnet delivery must have plan, drift, and apply GitHub environments."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-tailnet-infra-plan"].reviewers[0].users == toset([8760191])
    error_message = "The tailnet plan environment must require the declared reviewer."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-tailnet-infra"].reviewers[0].users == toset([8760191])
    error_message = "The tailnet apply environment must require the declared reviewer."
  }

  assert {
    condition     = length(github_repository_environment.managed["hq/production-tailnet-infra-drift"].reviewers) == 0
    error_message = "The tailnet drift environment must run without a reviewer gate."
  }

  assert {
    condition = toset([
      for policy in values(github_repository_environment_deployment_policy.managed) :
      "${policy.environment}/${policy.branch_pattern}"
      if startswith(policy.environment, "production-tailnet-infra")
      ]) == toset([
      "production-tailnet-infra-drift/main",
      "production-tailnet-infra/main",
    ])
    error_message = "Tailnet drift and apply must be restricted to main."
  }
}

run "personal_finance_delivery_boundaries" {
  command = plan

  assert {
    condition     = doppler_project.managed["personal-finance"].name == "personal-finance"
    error_message = "Personal Finance must have its own Doppler project."
  }

  assert {
    condition = toset([
      for environment in values(doppler_environment.managed) :
      "${environment.project}/${environment.slug}"
      if environment.project == "personal-finance"
      ]) == toset([
      "personal-finance/ops",
      "personal-finance/drift",
      "personal-finance/apply",
    ])
    error_message = "Personal Finance must separate plan, drift, and apply environment configs."
  }

  assert {
    condition = length([
      for config in values(doppler_config.managed) : config
      if config.project == "personal-finance"
    ]) == 0
    error_message = "Personal Finance must use free-tier environment root configs instead of paid config inheritance."
  }

  assert {
    condition = length([
      for environment in values(github_repository_environment.managed) : environment
      if startswith(environment.environment, "production-personal-finance")
    ]) == 3
    error_message = "Personal Finance must have plan, drift, and apply GitHub environments."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-personal-finance-plan"].reviewers[0].users == toset([8760191])
    error_message = "The Personal Finance plan environment must require the declared reviewer."
  }

  assert {
    condition     = github_repository_environment.managed["hq/production-personal-finance"].reviewers[0].users == toset([8760191])
    error_message = "The Personal Finance apply environment must require the declared reviewer."
  }

  assert {
    condition     = length(github_repository_environment.managed["hq/production-personal-finance-drift"].reviewers) == 0
    error_message = "The Personal Finance drift environment must run without a reviewer gate."
  }

  assert {
    condition = toset([
      for policy in values(github_repository_environment_deployment_policy.managed) :
      "${policy.environment}/${policy.branch_pattern}"
      if startswith(policy.environment, "production-personal-finance")
      ]) == toset([
      "production-personal-finance-drift/main",
      "production-personal-finance/main",
    ])
    error_message = "Personal Finance drift and apply must be restricted to main."
  }
}

run "vector_runtime_config_is_managed" {
  command = plan

  assert {
    condition = anytrue([
      for config in values(doppler_config.managed) :
      config.name == "prd_vector_development" &&
      config.project == "homelab" &&
      config.environment == "prd"
    ])
    error_message = "The existing Vector runtime config must be managed by account-foundation."
  }
}

run "cloudflare_token_bootstrap_is_restricted" {
  command = plan

  assert {
    condition = (
      doppler_project.managed["cloudflare-token-bootstrap"].name == "cloudflare-token-bootstrap" &&
      doppler_config.managed["cloudflare-token-bootstrap/ops/ops_provisioner"].name == "ops_provisioner"
    )
    error_message = "Cloudflare token authority must have a separately managed Doppler project and config."
  }

  assert {
    condition = (
      github_repository_environment.managed["hq/production-cloudflare-token-bootstrap"].can_admins_bypass == false &&
      github_repository_environment.managed["hq/production-cloudflare-token-bootstrap"].reviewers[0].users == toset([8760191]) &&
      github_repository_environment.managed["hq/production-cloudflare-token-bootstrap"].deployment_branch_policy[0].custom_branch_policies == true
    )
    error_message = "Cloudflare token provisioning must require a reviewer and the main branch."
  }

  assert {
    condition     = github_repository_environment_deployment_policy.managed["hq/production-cloudflare-token-bootstrap/main"].branch_pattern == "main"
    error_message = "Cloudflare token provisioning must be restricted to main."
  }
}
