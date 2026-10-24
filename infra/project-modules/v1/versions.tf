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
