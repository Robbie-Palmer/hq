terraform {
  required_version = "= 1.16.4"

  cloud {
    organization = "robbie-palmer"
    workspaces {
      name = "personal-site-personal-finance"
    }
  }
}
