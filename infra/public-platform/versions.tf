terraform {
  required_version = ">= 1.14"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18"
    }
    posthog = {
      source  = "PostHog/posthog"
      version = "~> 1.0"
    }
    restapi = {
      source  = "Mastercard/restapi"
      version = "~> 3.0"
    }
  }
}

provider "cloudflare" {
  # API token should be provided via CLOUDFLARE_API_TOKEN environment variable
}

provider "neon" {
  # API key should be provided via NEON_API_KEY environment variable
}

provider "posthog" {
  host       = var.posthog_host
  project_id = var.posthog_project_id
  # API key should be provided via POSTHOG_API_KEY.
}

# The official PostHog provider does not yet expose the newer Logs Alert API.
# Keep alert definitions in Terraform through a narrowly scoped REST provider
# until posthog_alert supports log-backed alerts.
provider "restapi" {
  uri                  = var.posthog_host
  bearer_token         = var.posthog_api_key
  write_returns_object = true
  update_method        = "PATCH"
}
