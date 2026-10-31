terraform {
  required_version = ">= 1.14, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52"
    }
    doppler = {
      source  = "DopplerHQ/doppler"
      version = "~> 1.21"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18"
    }
    posthog = {
      source  = "PostHog/posthog"
      version = "~> 1.0"
    }
    tfe = {
      source  = "hashicorp/tfe"
      version = "~> 0.82"
    }
  }
}

provider "cloudflare" {}
provider "doppler" {}
provider "github" {
  owner = "example"
}
provider "neon" {}
provider "posthog" {}
provider "tfe" {}

variable "state_scope" {
  type = string
}

variable "resolved_profile" {
  type = any
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "cloudflare_r2" {
  type    = any
  default = null
}

variable "cloudflare_worker" {
  type    = any
  default = null
}

variable "neon" {
  type    = any
  default = null
}

module "project" {
  source = "../../../v1"
  providers = {
    cloudflare = cloudflare
    doppler    = doppler
    github     = github
    neon       = neon
    posthog    = posthog
    tfe        = tfe
  }

  state_scope         = var.state_scope
  deletion_protection = var.deletion_protection
  resolved_profile    = var.resolved_profile
  cloudflare_r2       = var.cloudflare_r2
  cloudflare_worker   = var.cloudflare_worker
  neon                = var.neon
}
