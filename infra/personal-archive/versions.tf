terraform {
  required_version = ">= 1.14"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site-personal-archive"
    }
  }

  required_providers {
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.14"
    }
  }
}

provider "b2" {
  # B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY supply the scoped provider
  # credential at process runtime.
}
