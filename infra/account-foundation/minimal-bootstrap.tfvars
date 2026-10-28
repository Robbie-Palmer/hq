additional_roots = {
  platform-bootstrap-canary = {
    hcp = {
      project = {
        name               = "Platform bootstrap canary"
        tags               = { purpose = "disposable-bootstrap-proof" }
        deletion_protected = false
      }
      workspace = {
        workspace_name     = "platform-bootstrap-canary"
        terraform_version  = "1.16.4"
        tags               = { purpose = "disposable-bootstrap-proof" }
        state_consumers    = []
        deletion_protected = false
      }
    }
    delivery = {
      deletion_protected = false
      imported           = false
      doppler = {
        project = {
          name        = "platform-bootstrap-canary"
          description = "Disposable platform bootstrap proof"
        }
        environments = {
          preview = {
            name             = "Preview"
            personal_configs = false
            configs          = []
          }
          apply = {
            name             = "Apply"
            personal_configs = false
            configs          = []
          }
        }
      }
      github = {
        repository = "hq"
        environments = {
          preview = {
            name                 = "platform-bootstrap-canary-preview"
            custom_branch_policy = true
            branch_patterns      = { "pull-request/**" = null }
          }
          apply = {
            name                 = "platform-bootstrap-canary-apply"
            custom_branch_policy = true
            branch_patterns      = { main = null }
          }
        }
      }
    }
  }
}
