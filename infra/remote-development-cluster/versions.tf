terraform {
  required_version = "= 1.16.4"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site-remote-development-cluster"
    }
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "= 1.69.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}
