variable "hcloud_token" {
  description = "Read/write API token for the isolated Hetzner candidate project"
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.hcloud_token)) > 0
    error_message = "hcloud_token must not be empty."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key used for cluster recovery"
  type        = string

  validation {
    condition     = can(regex("^(ssh-(ed25519|rsa)|ecdsa-[^ ]+) [A-Za-z0-9+/=]+( .*)?$", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key must be a complete OpenSSH public key."
  }
}

variable "ssh_private_key" {
  description = "Private key used only by Kube-Hetzner provisioners; use null with a loaded SSH agent"
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

variable "leapmicro_x86_snapshot_id" {
  description = "Pinned candidate-project snapshot built from Kube-Hetzner 3.1.0"
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.leapmicro_x86_snapshot_id))
    error_message = "leapmicro_x86_snapshot_id must be a positive Hetzner image ID."
  }
}

variable "tailscale_oauth_client_secret" {
  description = "Tailscale OAuth client secret allowed to create tagged candidate-cluster devices"
  type        = string
  sensitive   = true
}

variable "tailscale_magicdns_domain" {
  description = "Tailnet MagicDNS domain, without a trailing dot"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+\\.ts\\.net$", var.tailscale_magicdns_domain))
    error_message = "tailscale_magicdns_domain must look like example-tailnet.ts.net."
  }
}

variable "etcd_s3_endpoint" {
  description = "S3-compatible endpoint used for encrypted etcd snapshots"
  type        = string
}

variable "etcd_s3_access_key" {
  description = "Access key scoped to the candidate etcd snapshot bucket"
  type        = string
  sensitive   = true
}

variable "etcd_s3_secret_key" {
  description = "Secret key scoped to the candidate etcd snapshot bucket"
  type        = string
  sensitive   = true
}

variable "etcd_s3_bucket" {
  description = "Bucket used for candidate etcd snapshots"
  type        = string
}

variable "etcd_s3_region" {
  description = "S3 region understood by the snapshot backend"
  type        = string
  default     = "auto"
}
