terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "account_id" { type = string }
variable "name" { type = string }
variable "production_branch" { type = string }
variable "build_command" { type = string }
variable "destination_dir" { type = string }
variable "root_dir" { type = string }
variable "production_variables" { type = map(string) }
variable "preview_variables" { type = map(string) }
variable "compatibility_date" { type = string }
variable "compatibility_flags" { type = set(string) }

resource "cloudflare_pages_project" "project" {
  account_id        = var.account_id
  name              = var.name
  production_branch = var.production_branch

  build_config {
    build_command   = var.build_command
    destination_dir = var.destination_dir
    root_dir        = var.root_dir
  }

  deployment_configs {
    production {
      environment_variables = var.production_variables
      compatibility_date    = var.compatibility_date
      compatibility_flags   = var.compatibility_flags
    }

    preview {
      environment_variables = var.preview_variables
      compatibility_date    = var.compatibility_date
      compatibility_flags   = var.compatibility_flags
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "project_id" {
  value = cloudflare_pages_project.project.id
}

output "subdomain" {
  value = cloudflare_pages_project.project.subdomain
}
