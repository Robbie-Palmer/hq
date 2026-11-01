variable "server_name" {
  description = "Hostname and Hetzner resource name for the remote development server"
  type        = string
  default     = "remote-development"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.server_name))
    error_message = "server_name must be a lowercase RFC 1123 hostname no longer than 63 characters."
  }
}

variable "server_type" {
  description = "Hetzner Cloud server type; cx33 currently provides 4 shared x86 vCPUs and 8 GB RAM"
  type        = string
  default     = "cx33"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.server_type))
    error_message = "server_type must be a valid Hetzner server-type name."
  }
}

variable "location" {
  description = "Hetzner Cloud location shared by the server and persistent volume"
  type        = string
  default     = "nbg1"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.location))
    error_message = "location must be a valid Hetzner location name."
  }
}

variable "bootstrap_image" {
  description = "Temporary Linux image used only as the nixos-anywhere installation target"
  type        = string
  default     = "ubuntu-24.04"

  validation {
    condition     = length(trimspace(var.bootstrap_image)) > 0
    error_message = "bootstrap_image must not be empty."
  }
}

variable "ssh_public_key" {
  description = "Public SSH key injected for initial NixOS installation; never provide a private key"
  type        = string

  validation {
    condition     = can(regex("^ssh-(ed25519|rsa|ecdsa-[^ ]+) [A-Za-z0-9+/=]+( .*)?$", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key must be a complete OpenSSH public key."
  }
}

variable "bootstrap_ssh_cidrs" {
  description = "Temporary source CIDRs allowed to reach SSH when bootstrap_mode_enabled is true"
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.bootstrap_ssh_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Every bootstrap_ssh_cidrs entry must be a valid IPv4 or IPv6 CIDR."
  }
}

variable "bootstrap_mode_enabled" {
  description = "Explicitly enable temporary public SSH access for installation or recovery"
  type        = bool
  default     = false
}

variable "data_volume_size_gb" {
  description = "Size of the persistent workspace volume in GiB; Hetzner volumes can grow but not shrink"
  type        = number
  default     = 100

  validation {
    condition     = var.data_volume_size_gb >= 10 && var.data_volume_size_gb <= 10240 && floor(var.data_volume_size_gb) == var.data_volume_size_gb
    error_message = "data_volume_size_gb must be a whole number between 10 and 10240."
  }
}

variable "enable_backups" {
  description = "Enable Hetzner backups of the server root disk; attached volumes are excluded"
  type        = bool
  default     = false
}

variable "server_state" {
  description = "Desired server lifecycle state: active, suspend-ready, or suspended"
  type        = string
  default     = "suspend-ready"

  validation {
    condition     = contains(["active", "suspend-ready", "suspended"], var.server_state)
    error_message = "server_state must be active, suspend-ready, or suspended."
  }
}

variable "enable_volume_delete_protection" {
  description = "Protect the persistent workspace volume against deletion in the Hetzner API"
  type        = bool
  default     = true
}

variable "labels" {
  description = "Additional non-secret labels applied to all supported Hetzner resources"
  type        = map(string)
  default     = {}
}
