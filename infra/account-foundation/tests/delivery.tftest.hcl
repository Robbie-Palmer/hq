mock_provider "doppler" {}

mock_provider "github" {
  mock_data "github_user" {
    defaults = {
      id = 8760191
    }
  }
}

mock_provider "tfe" {}

run "cloudflare_access_delivery_boundaries" {
  command = plan

  assert {
    condition     = doppler_project.managed["cloudflare-access"].name == "cloudflare-access"
    error_message = "The canary must have its own Doppler project."
  }

  assert {
    condition     = doppler_environment.managed["cloudflare-access/ops"].slug == "ops"
    error_message = "The canary must have an operations environment."
  }

  assert {
    condition     = toset([for config in values(doppler_config.managed) : config.name]) == toset(["ops_plan", "ops_drift", "ops_apply"])
    error_message = "The canary must separate plan, drift, and apply configs."
  }

  assert {
    condition     = length(github_repository_environment.managed) == 3
    error_message = "The canary must have plan, drift, and apply GitHub environments."
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
      for policy in values(github_repository_environment_deployment_policy.managed) : policy.branch_pattern
    ]) == toset(["main"])
    error_message = "Drift and apply must be restricted to the main branch."
  }

  assert {
    condition     = length(github_repository_environment_deployment_policy.managed) == 2
    error_message = "Only the drift and apply environments may use custom branch policies."
  }
}
