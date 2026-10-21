terraform {
  required_version = ">= 1.14"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site-cloudflare-access"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27.0"
    }
  }
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN supplies the provider credential at process runtime.
}
