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
    restapi = {
      source  = "Mastercard/restapi"
      version = "~> 3.0"
    }
  }
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN supplies the provider credential at process runtime.
}

# Cloudflare provider v5 cannot safely adopt an already-rotated service token:
# its import plan injects client_secret_version = 1 and attempts a rotation.
# Use the Cloudflare API directly so updates can never send that field.
provider "restapi" {
  uri                  = "https://api.cloudflare.com/client/v4/accounts/${var.cloudflare_account_id}"
  bearer_token         = var.cloudflare_api_token
  write_returns_object = false
  update_method        = "PUT"
}
