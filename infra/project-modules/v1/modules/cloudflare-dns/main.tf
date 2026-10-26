terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "zone_id" { type = string }
variable "records" {
  type = map(object({
    name    = string
    content = string
    type    = string
    proxied = optional(bool, true)
    ttl     = optional(number, 1)
  }))
}

resource "cloudflare_record" "record" {
  for_each = var.records

  zone_id = var.zone_id
  name    = each.value.name
  content = each.value.content
  type    = each.value.type
  proxied = each.value.proxied
  ttl     = each.value.ttl

  lifecycle {
    prevent_destroy = true
  }
}

output "record_ids" {
  value = { for key, record in cloudflare_record.record : key => record.id }
}
