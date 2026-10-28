terraform {
  required_version = ">= 1.14, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18"
    }
  }
}
