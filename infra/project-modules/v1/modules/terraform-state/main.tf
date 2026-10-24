terraform {
  required_providers {
    tfe = {
      source = "hashicorp/tfe"
    }
  }
}

variable "organization" {
  type = string
}

variable "project_name" {
  type = string
}

variable "workspace_name" {
  type = string
}

variable "terraform_version" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "tfe_project" "project" {
  name         = var.project_name
  organization = var.organization
  tags         = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "tfe_workspace" "project" {
  name                  = var.workspace_name
  organization          = var.organization
  project_id            = tfe_project.project.id
  terraform_version     = var.terraform_version
  queue_all_runs        = false
  file_triggers_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "tfe_workspace_settings" "project" {
  workspace_id         = tfe_workspace.project.id
  execution_mode       = "local"
  auto_apply           = false
  global_remote_state  = false
  project_remote_state = false
  tags                 = var.tags
}

output "workspace_id" {
  value = tfe_workspace.project.id
}
