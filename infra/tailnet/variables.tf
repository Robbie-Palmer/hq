variable "user_logins" {
  description = "Private Tailscale user logins keyed by policy role"
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition = alltrue([
      for role, login in var.user_logins :
      can(regex("^[a-z][a-z0-9_]*$", role)) && trimspace(login) != ""
    ])
    error_message = "User-login keys must use lowercase snake case and values must not be empty."
  }
}

# The baseline ticket will consume this map when it adds DNS and policy values.
# tflint-ignore: terraform_unused_declarations
variable "private_addresses" {
  description = "Private tailnet addresses keyed by their policy or DNS purpose"
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition = alltrue([
      for purpose, address in var.private_addresses :
      can(regex("^[a-z][a-z0-9_]*$", purpose)) && trimspace(address) != ""
    ])
    error_message = "Private-address keys must use lowercase snake case and values must not be empty."
  }
}
