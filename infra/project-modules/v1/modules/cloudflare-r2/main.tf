terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "account_id" { type = string }
variable "buckets" {
  type = map(object({
    name     = string
    location = optional(string, "ENAM")
  }))
}

resource "cloudflare_r2_bucket" "bucket" {
  for_each = var.buckets

  account_id = var.account_id
  name       = each.value.name
  location   = each.value.location

  lifecycle {
    prevent_destroy = true
  }
}

output "bucket_ids" {
  value = { for key, bucket in cloudflare_r2_bucket.bucket : key => bucket.id }
}
