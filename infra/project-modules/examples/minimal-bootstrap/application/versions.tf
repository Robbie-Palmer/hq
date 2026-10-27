terraform {
  required_version = ">= 1.14, < 2.0"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "platform-bootstrap-canary"
    }
  }

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
