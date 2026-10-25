# Add tailscale_acl only after this value represents the effective policy and
# the operator can import the live document safely.
locals {
  # Populate these collections from the tailnet's effective policy before
  # tailscale_acl enters state. The composition remains explicit without
  # committing a rendered policy or private substitutions.
  # tflint-ignore: terraform_unused_declarations
  tailnet_policy = {
    groups = {
      for role, login in var.user_logins : "group:${role}" => [login]
    }
    tagOwners = {}
    grants    = []
    ssh       = []
    autoApprovers = {
      routes   = {}
      exitNode = []
    }
    tests    = []
    sshTests = []
  }
}
