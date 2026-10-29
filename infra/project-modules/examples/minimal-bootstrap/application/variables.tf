variable "enabled" {
  description = "Create the disposable preview. Set false only for a reviewed cleanup plan."
  type        = bool
  default     = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the disposable preview resources."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone that owns the disposable preview hostname."
  type        = string
}

variable "neon_org_id" {
  description = "Neon organization that owns the disposable preview project."
  type        = string
}

variable "reviewer_emails" {
  description = "Human reviewers allowed through the disposable Access application."
  type        = set(string)
}
