terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "account_id" { type = string }
variable "name" { type = string }
variable "content" { type = string }
variable "compatibility_date" { type = string }
variable "zone_id" {
  type     = string
  default  = null
  nullable = true
}
variable "hostname" {
  type     = string
  default  = null
  nullable = true
}

resource "cloudflare_workers_script" "worker" {
  account_id         = var.account_id
  name               = var.name
  content            = var.content
  module             = true
  compatibility_date = var.compatibility_date

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [content]
  }
}

resource "cloudflare_workers_domain" "worker" {
  count = var.zone_id != null && var.hostname != null ? 1 : 0

  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.hostname
  service    = cloudflare_workers_script.worker.name

  lifecycle {
    prevent_destroy = true
  }
}

check "domain_configuration_is_complete" {
  assert {
    condition     = (var.zone_id == null) == (var.hostname == null)
    error_message = "zone_id and hostname must be supplied together."
  }
}

output "worker_id" {
  value = cloudflare_workers_script.worker.id
}
