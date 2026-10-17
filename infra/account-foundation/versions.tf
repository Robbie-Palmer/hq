terraform {
  required_version = ">= 1.14"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site-account-foundation"
    }
  }

  required_providers {
    doppler = {
      source  = "DopplerHQ/doppler"
      version = "~> 1.21"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
    tfe = {
      source  = "hashicorp/tfe"
      version = "~> 0.80"
    }
  }
}
