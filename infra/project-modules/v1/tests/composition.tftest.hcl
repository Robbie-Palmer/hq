mock_provider "cloudflare" {}
mock_provider "doppler" {}
mock_provider "github" {
  mock_data "github_user" {
    defaults = {
      id = 8760191
    }
  }
}
mock_provider "neon" {}
mock_provider "posthog" {}
mock_provider "tfe" {}

variables {
  state_scope = "application"
  resolved_profile = {
    schema_version = 2
    project = {
      id   = "minimal-project"
      name = "Minimal project"
    }
    selections = []
  }
}

run "unselected_capabilities_create_nothing" {
  command = plan

  assert {
    condition = (
      length(output.selected_capabilities) == 0 &&
      length(module.terraform_state) == 0 &&
      length(module.delivery) == 0 &&
      length(module.cloudflare_pages) == 0 &&
      length(module.cloudflare_worker) == 0 &&
      length(module.cloudflare_access) == 0 &&
      length(module.cloudflare_r2) == 0 &&
      length(module.cloudflare_dns) == 0 &&
      length(module.neon) == 0 &&
      length(module.telemetry) == 0
    )
    error_message = "A profile with no managed infrastructure selections must create no resources or credentials."
  }
}

run "pages_and_storage_are_composed_independently" {
  command = plan

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "static-site"
        name = "Static site"
      }
      selections = [
        { slot = "web-app.host", value = "cloudflare-pages" },
        { slot = "storage.object-store", value = "cloudflare-r2" },
      ]
    }
    cloudflare_pages = {
      account_id         = "dcd7cd68dd892d610267ded6b1af567b"
      name               = "static-site"
      production_branch  = "main"
      build_command      = "mise //ui:build"
      destination_dir    = "ui/out"
      compatibility_date = "2026-10-24"
    }
    cloudflare_r2 = {
      account_id = "dcd7cd68dd892d610267ded6b1af567b"
      buckets = {
        uploads = { name = "static-site-uploads" }
      }
    }
  }

  assert {
    condition = output.selected_capabilities == toset([
      "storage.object-store",
      "web-app.host",
    ])
    error_message = "Composition must expose the stable profile slots it instantiated."
  }

  assert {
    condition = (
      length(module.cloudflare_pages) == 1 &&
      length(module.cloudflare_r2) == 1 &&
      length(module.cloudflare_worker) == 0 &&
      length(module.cloudflare_access) == 0 &&
      length(module.cloudflare_dns) == 0 &&
      length(module.neon) == 0 &&
      length(module.telemetry) == 0
    )
    error_message = "Selecting Pages and R2 must not opt the project into other capabilities."
  }
}

run "state_delivery_and_runtime_capabilities_compose" {
  command = plan

  variables {
    state_scope = "bootstrap"
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "stateful-service"
        name = "Stateful service"
      }
      selections = [
        { slot = "infrastructure.state-backend", value = "terraform-cloud" },
        { slot = "delivery.ci", value = "github-actions" },
        { slot = "backend-api.runtime", value = "cloudflare-workers" },
        { slot = "security.preview-access", value = "cloudflare-access" },
        { slot = "network.public-ingress", value = "explicit" },
        { slot = "database.relational-host", value = "neon" },
        { slot = "database.preview-isolation", value = "fresh" },
        { slot = "observability.application-telemetry", value = "posthog" },
      ]
    }
    terraform_state = {
      organization      = "example"
      project_name      = "Stateful service"
      workspace_name    = "stateful-service"
      terraform_version = "1.16.4"
    }
    delivery = {
      doppler_project_name        = "stateful-service"
      doppler_project_description = "Stateful service delivery configuration"
      repository                  = "hq"
      environments = {
        plan = {
          doppler_environment_name = "Plan"
          doppler_configs          = ["plan", "plan_ci"]
          github_environment_name  = "stateful-service-plan"
          reviewer_usernames       = ["reviewer"]
        }
        apply = {
          doppler_environment_name = "Apply"
          doppler_configs          = ["apply"]
          github_environment_name  = "stateful-service-apply"
          protected_branches       = true
        }
      }
    }
  }

  assert {
    condition = (
      length(module.terraform_state) == 1 &&
      length(module.delivery) == 1 &&
      length(module.cloudflare_worker) == 0 &&
      length(module.cloudflare_access) == 0 &&
      length(module.cloudflare_dns) == 0 &&
      length(module.neon) == 0 &&
      length(module.telemetry) == 0 &&
      length(module.cloudflare_pages) == 0 &&
      length(module.cloudflare_r2) == 0
    )
    error_message = "The bootstrap scope must plan state and delivery containers without application resources."
  }

  assert {
    condition     = length(module.delivery["selected"].resource_ids.doppler_configs) == 1
    error_message = "Delivery composition must leave environment root configs provider-owned and create only named branch configs."
  }
}

run "application_state_excludes_bootstrap_resources" {
  command = plan

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "stateful-service"
        name = "Stateful service"
      }
      selections = [
        { slot = "infrastructure.state-backend", value = "terraform-cloud" },
        { slot = "delivery.ci", value = "github-actions" },
        { slot = "backend-api.runtime", value = "cloudflare-workers" },
        { slot = "security.preview-access", value = "cloudflare-access" },
        { slot = "network.public-ingress", value = "explicit" },
        { slot = "database.relational-host", value = "neon" },
        { slot = "database.preview-isolation", value = "fresh" },
        { slot = "observability.application-telemetry", value = "posthog" },
      ]
    }
    cloudflare_worker = {
      account_id         = "dcd7cd68dd892d610267ded6b1af567b"
      name               = "stateful-service"
      content            = "export default { fetch() { return new Response('unconfigured', { status: 503 }); } };"
      compatibility_date = "2026-10-24"
    }
    cloudflare_access = {
      account_id     = "dcd7cd68dd892d610267ded6b1af567b"
      name           = "Stateful service previews"
      domain         = "*.preview.example.com"
      allowed_emails = ["reviewer@example.com"]
    }
    cloudflare_dns = {
      zone_id = "023e105f4ecef8ad9ca31a8372d0c353"
      records = {
        api = {
          name    = "api"
          content = "stateful-service.workers.dev"
          type    = "CNAME"
        }
      }
    }
    neon = {
      org_id               = "org-example"
      project_name         = "stateful-service"
      database_name        = "stateful_service"
      role_name            = "stateful_service_owner"
      region_id            = "aws-us-east-1"
      pg_version           = 17
      preview_project_name = "stateful-service-preview"
    }
    telemetry = {
      dashboard_name        = "Stateful service operations"
      dashboard_description = "Operational signals owned by Stateful service"
    }
  }

  assert {
    condition = (
      length(module.terraform_state) == 0 &&
      length(module.delivery) == 0 &&
      length(module.cloudflare_worker) == 1 &&
      length(module.cloudflare_access) == 1 &&
      length(module.cloudflare_dns) == 1 &&
      length(module.neon) == 1 &&
      length(module.telemetry) == 1
    )
    error_message = "The application scope must plan selected workload resources without bootstrap resources."
  }

  assert {
    condition     = module.neon["selected"].preview_enabled
    error_message = "Preview database selection must create one isolated project."
  }
}

run "configuration_cannot_enable_an_unselected_capability" {
  command = plan

  variables {
    cloudflare_r2 = {
      account_id = "dcd7cd68dd892d610267ded6b1af567b"
      buckets = {
        accidental = { name = "accidental" }
      }
    }
  }

  expect_failures = [terraform_data.profile_guard]
}

run "selected_capability_requires_configuration" {
  command = plan

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "missing-config"
        name = "Missing config"
      }
      selections = [
        { slot = "backend-api.runtime", value = "cloudflare-workers" },
      ]
    }
  }

  expect_failures = [terraform_data.profile_guard]
}

run "preview_database_requires_a_distinct_project" {
  command = plan

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "invalid-preview-database"
        name = "Invalid preview database"
      }
      selections = [
        { slot = "database.relational-host", value = "neon" },
        { slot = "database.preview-isolation", value = "fresh" },
      ]
    }
    neon = {
      org_id               = "org-example"
      project_name         = "shared-database"
      database_name        = "application"
      role_name            = "application_owner"
      region_id            = "aws-us-east-1"
      pg_version           = 17
      preview_project_name = "shared-database"
    }
  }

  expect_failures = [terraform_data.profile_guard]
}

run "alternative_preview_access_provider_is_not_selected" {
  command = plan

  variables {
    resolved_profile = {
      schema_version = 2
      project = {
        id   = "alternative-preview-access"
        name = "Alternative preview access"
      }
      selections = [
        { slot = "security.preview-access", value = "private-overlay" },
      ]
    }
  }

  assert {
    condition = (
      !contains(output.selected_capabilities, "security.preview-access") &&
      length(module.cloudflare_access) == 0
    )
    error_message = "An alternative preview-access technology must not instantiate Cloudflare Access."
  }
}
