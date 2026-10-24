terraform {
  required_providers {
    posthog = {
      source = "PostHog/posthog"
    }
  }
}

variable "project_id" { type = string }
variable "dashboard_name" { type = string }
variable "dashboard_description" { type = string }
variable "tags" { type = set(string) }

resource "posthog_dashboard" "project" {
  name        = var.dashboard_name
  description = var.dashboard_description
  pinned      = true
  tags        = setunion(var.tags, ["project:${var.project_id}"])

  lifecycle {
    prevent_destroy = true
  }
}

output "dashboard_id" {
  value = posthog_dashboard.project.id
}
