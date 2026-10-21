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

run "reject_invalid_additional_workspace_name" {
  command = plan

  variables {
    additional_roots = {
      invalid = {
        hcp = {
          project = {
            name               = "Invalid workspace test"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "INVALID"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "invalid-workspace-test"
              description = "Invalid workspace validation test"
            }
            environments = {}
          }
          github = {
            repository   = "hq"
            environments = {}
          }
        }
      }
    }
  }

  expect_failures = [var.additional_roots]
}

run "reject_inexact_additional_terraform_version" {
  command = plan

  variables {
    additional_roots = {
      invalid = {
        hcp = {
          project = {
            name               = "Invalid version test"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "invalid-version-test"
            terraform_version  = "~> 1.16"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "invalid-version-test"
              description = "Invalid Terraform version validation test"
            }
            environments = {}
          }
          github = {
            repository   = "hq"
            environments = {}
          }
        }
      }
    }
  }

  expect_failures = [var.additional_roots]
}

run "reject_duplicate_hcp_workspace_name" {
  command = plan

  variables {
    hcp_projects = {
      existing = {
        name               = "Existing project"
        tags               = {}
        deletion_protected = false
      }
    }
    hcp_roots = {
      existing = {
        workspace_name     = "duplicate-workspace"
        project            = "existing"
        terraform_version  = "1.16.4"
        tags               = {}
        state_consumers    = []
        deletion_protected = false
      }
    }
    additional_roots = {
      duplicate = {
        hcp = {
          project = {
            name               = "Duplicate workspace project"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "duplicate-workspace"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "duplicate-workspace-test"
              description = "Duplicate workspace validation test"
            }
            environments = {}
          }
          github = {
            repository   = "hq"
            environments = {}
          }
        }
      }
    }
  }

  expect_failures = [var.additional_roots]
}

run "reject_hcp_registry_identifier_collisions" {
  command = plan

  variables {
    hcp_projects = {
      collision = {
        name               = "Existing collision project"
        tags               = {}
        deletion_protected = false
      }
    }
    hcp_roots = {
      collision = {
        workspace_name     = "existing-collision-workspace"
        project            = "collision"
        terraform_version  = "1.16.4"
        tags               = {}
        state_consumers    = []
        deletion_protected = false
      }
    }
    additional_roots = {
      collision = {
        hcp = {
          project = {
            name               = "Replacement collision project"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "replacement-collision-workspace"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "hcp-collision-test"
              description = "HCP registry collision test"
            }
            environments = {}
          }
          github = {
            repository   = "hq"
            environments = {}
          }
        }
      }
    }
  }

  expect_failures = [data.tfe_workspace.account_foundation_seed]
}

run "reject_delivery_root_identifier_collision" {
  command = plan

  variables {
    additional_roots = {
      homelab = {
        hcp = {
          project = {
            name               = "Delivery root collision project"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "delivery-root-collision"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "delivery-root-collision"
              description = "Delivery root collision test"
            }
            environments = {}
          }
          github = {
            repository   = "hq"
            environments = {}
          }
        }
      }
    }
  }

  expect_failures = [data.tfe_workspace.account_foundation_seed]
}

run "reject_derived_delivery_identifier_collisions" {
  command = plan

  variables {
    additional_roots = {
      first = {
        hcp = {
          project = {
            name               = "First collision project"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "first-collision-workspace"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "shared-collision-project"
              description = "First derived identifier collision test"
            }
            environments = {
              ops = {
                name             = "Operations"
                personal_configs = false
                configs          = ["ops"]
              }
            }
          }
          github = {
            repository = "hq"
            environments = {
              shared = {
                name                 = "shared-collision-environment"
                custom_branch_policy = true
                branch_patterns      = { main = null }
              }
            }
          }
        }
      }
      second = {
        hcp = {
          project = {
            name               = "Second collision project"
            tags               = {}
            deletion_protected = false
          }
          workspace = {
            workspace_name     = "second-collision-workspace"
            terraform_version  = "1.16.4"
            tags               = {}
            state_consumers    = []
            deletion_protected = false
          }
        }
        delivery = {
          deletion_protected = false
          imported           = false
          doppler = {
            project = {
              name        = "shared-collision-project"
              description = "Second derived identifier collision test"
            }
            environments = {
              ops = {
                name             = "Operations"
                personal_configs = false
                configs          = ["ops"]
              }
            }
          }
          github = {
            repository = "hq"
            environments = {
              shared = {
                name                 = "shared-collision-environment"
                custom_branch_policy = true
                branch_patterns      = { main = null }
              }
            }
          }
        }
      }
    }
  }

  expect_failures = [data.tfe_workspace.account_foundation_seed]
}
