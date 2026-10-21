variable "bucket_name" {
  description = "Globally unique name of the private Backblaze B2 personal archive bucket"
  type        = string
  default     = "robbie-personal-archive"

  validation {
    condition = (
      length(var.bucket_name) >= 6 &&
      length(var.bucket_name) <= 50 &&
      can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.bucket_name))
    )
    error_message = "The bucket name must contain 6 through 50 lowercase letters, numbers, or hyphens and must start and end with a letter or number."
  }
}
