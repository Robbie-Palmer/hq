variable "hcp_projects" {
  description = "HCP Terraform projects referenced by the root registry"
  type = map(object({
    name               = string
    tags               = map(string)
    deletion_protected = optional(bool, true)
    import_id          = optional(string)
  }))

  default = {
    default = {
      name               = "Default Project"
      tags               = {}
      deletion_protected = true
      import_id          = "prj-ZVLoxaAVYbBEHJwH"
    }
  }

  validation {
    condition = alltrue([
      for key, project in var.hcp_projects :
      can(regex("^[a-z0-9][a-z0-9-]*$", key)) &&
      length(trimspace(project.name)) >= 3 &&
      length(project.name) <= 40 &&
      (project.import_id == null || can(regex("^prj-[A-Za-z0-9]+$", project.import_id)))
    ])
    error_message = "HCP project keys must be lowercase slugs, names must contain 3 through 40 characters, and import IDs must start with prj-."
  }
}

variable "hcp_roots" {
  description = "Registry of independently stateful roots whose HCP workspaces account-foundation manages"
  type = map(object({
    workspace_name        = string
    project               = string
    terraform_version     = string
    queue_all_runs        = optional(bool, false)
    file_triggers_enabled = optional(bool, true)
    tags                  = map(string)
    state_consumers       = set(string)
    deletion_protected    = optional(bool, true)
    import_id             = optional(string)
  }))

  default = {
    public-platform = {
      workspace_name    = "personal-site"
      project           = "default"
      terraform_version = "1.13.4"
      tags              = {}
      state_consumers   = []
      import_id         = "ws-qaWEomysU9Ep9wDs"
    }
    bootstrap = {
      workspace_name    = "personal-site-bootstrap"
      project           = "default"
      terraform_version = "1.15.7"
      tags              = {}
      state_consumers   = []
      import_id         = "ws-DyQ4QhHWWpPsRWgv"
    }
    cloudflare-access = {
      workspace_name    = "personal-site-cloudflare-access"
      project           = "default"
      terraform_version = "1.16.4"
      tags              = {}
      state_consumers   = []
    }
    remote-development = {
      workspace_name    = "personal-site-remote-development"
      project           = "default"
      terraform_version = "1.16.1"
      tags              = {}
      state_consumers   = []
      import_id         = "ws-64FJmz4zhCYqNwvg"
    }
    personal-archive = {
      workspace_name    = "personal-site-personal-archive"
      project           = "default"
      terraform_version = "1.16.4"
      tags              = {}
      state_consumers   = []
    }
    remote-development-cluster = {
      workspace_name    = "personal-site-remote-development-cluster"
      project           = "default"
      terraform_version = "1.16.4"
      tags              = {}
      state_consumers   = []
      import_id         = "ws-ZbESd7FQxv44fJma"
    }
    work-graph = {
      workspace_name    = "personal-site-work-graph"
      project           = "default"
      terraform_version = "1.16.2"
      tags              = {}
      state_consumers   = []
      import_id         = "ws-k55u12qJwQPzzNks"
    }
    personal-blog = {
      workspace_name        = "personal-blog"
      project               = "default"
      terraform_version     = "1.13.3"
      file_triggers_enabled = false
      tags                  = {}
      state_consumers       = []
      import_id             = "ws-HjanmaPgxFzm1t8F"
    }
  }

  validation {
    condition = alltrue([
      for key, root in var.hcp_roots :
      can(regex("^[a-z0-9][a-z0-9-]*$", key)) &&
      can(regex("^[a-z0-9][a-z0-9-]{2,89}$", root.workspace_name)) &&
      can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", root.terraform_version)) &&
      (root.import_id == null || can(regex("^ws-[A-Za-z0-9]+$", root.import_id)))
    ])
    error_message = "HCP root keys and workspace names must be lowercase slugs, Terraform versions must be exact, and import IDs must start with ws-."
  }

  validation {
    condition     = length(distinct([for root in values(var.hcp_roots) : root.workspace_name])) == length(var.hcp_roots)
    error_message = "Each HCP root must have a unique workspace name."
  }

  validation {
    condition = !contains(
      [for root in values(var.hcp_roots) : root.workspace_name],
      "personal-site-account-foundation",
    )
    error_message = "The account-foundation workspace is a manual seed and must never appear in the managed root registry."
  }
}

variable "additional_roots" {
  description = "Temporary or newly onboarded roots whose HCP and delivery boundaries are declared together"
  type = map(object({
    hcp = object({
      project = object({
        name               = string
        tags               = map(string)
        deletion_protected = optional(bool, true)
      })
      workspace = object({
        workspace_name        = string
        terraform_version     = string
        queue_all_runs        = optional(bool, false)
        file_triggers_enabled = optional(bool, true)
        tags                  = map(string)
        state_consumers       = set(string)
        deletion_protected    = optional(bool, true)
      })
    })
    delivery = object({
      deletion_protected = optional(bool, true)
      imported           = optional(bool, false)
      doppler = object({
        project = object({
          name        = string
          description = string
        })
        environments = map(object({
          name             = string
          personal_configs = bool
          configs          = set(string)
        }))
      })
      github = object({
        repository = string
        environments = map(object({
          name                 = string
          can_admins_bypass    = optional(bool, true)
          prevent_self_review  = optional(bool, false)
          reviewer_usernames   = optional(set(string), [])
          protected_branches   = optional(bool, false)
          custom_branch_policy = optional(bool, false)
          branch_patterns      = optional(map(string), {})
        }))
      })
    })
  }))
  default = {}

  validation {
    condition = alltrue([
      for key, root in var.additional_roots :
      can(regex("^[a-z0-9][a-z0-9-]*$", key)) &&
      root.hcp.project.deletion_protected == root.hcp.workspace.deletion_protected &&
      root.hcp.workspace.deletion_protected == root.delivery.deletion_protected &&
      root.delivery.imported == false &&
      root.hcp.workspace.workspace_name != "personal-site-account-foundation"
    ])
    error_message = "Additional roots must use lowercase slug keys, one deletion policy across HCP and delivery, must be newly created rather than imported, and cannot manage the account-foundation seed."
  }
}

variable "enable_existing_imports" {
  description = "Run declarative imports for existing delivery resources; tests disable imports because mock providers cannot import"
  type        = bool
  default     = true
}
