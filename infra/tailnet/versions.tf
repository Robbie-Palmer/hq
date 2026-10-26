terraform {
  required_version = "= 1.16.4"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "hq-tailnet"
    }
  }

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.29.2"
    }
  }
}

provider "tailscale" {
  # OAuth and tailnet values come from the standard TAILSCALE_* environment
  # variables. Never put them in Terraform variables or committed files.
}
