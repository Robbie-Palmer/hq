# The baseline ticket will pass this value to tailscale_acl after it represents
# the effective policy and the operator can import the live document safely.
locals {
  # The baseline ticket will replace these empty collections with the imported
  # tailnet's effective policy before tailscale_acl enters state. Keeping the
  # composition here makes the public structure explicit without committing a
  # rendered policy or private substitutions.
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
