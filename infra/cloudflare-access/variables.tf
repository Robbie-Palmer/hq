variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the shared Zero Trust configuration"
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "pages_host" {
  description = "Cloudflare Pages hostname protected by the shared Access application"
  type        = string
  default     = "personal-site-bu5.pages.dev"

  validation {
    condition = (
      can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$", var.pages_host)) &&
      length(regexall("\\.", var.pages_host)) > 0 &&
      length(regexall("\\.\\.", var.pages_host)) == 0
    )
    error_message = "pages_host must be a hostname without a scheme, path, query, or empty label."
  }
}

variable "verify_no_access_groups" {
  description = "Query Cloudflare and fail plans when an undeclared Access group exists"
  type        = bool
  default     = true
}
