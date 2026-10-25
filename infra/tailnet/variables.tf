variable "user_logins" {
  description = "Private Tailscale user logins keyed by operator or restricted policy role"
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

variable "private_addresses" {
  description = "Private tailnet addresses keyed by lab_host or primary_dns purpose"
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
