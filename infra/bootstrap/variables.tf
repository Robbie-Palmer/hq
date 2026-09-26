variable "github_repo_owner" {
  description = "GitHub repository owner/organization"
  type        = string
  default     = "Robbie-Palmer"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.github_repo_owner))
    error_message = "github_repo_owner must contain only letters, numbers, dots, underscores, and hyphens."
  }
}

variable "github_repo_name" {
  description = "GitHub repository name"
  type        = string
  default     = "hq"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.github_repo_name))
    error_message = "github_repo_name must contain only letters, numbers, dots, underscores, and hyphens."
  }
}

variable "github_repo_owner_id" {
  description = "Immutable GitHub ID of the repository owner used in OIDC subjects"
  type        = string
  default     = "8760191"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repo_owner_id))
    error_message = "github_repo_owner_id must contain only numbers."
  }
}

variable "github_repo_id" {
  description = "Immutable GitHub repository ID used in OIDC subjects"
  type        = string
  default     = "1078839304"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repo_id))
    error_message = "github_repo_id must contain only numbers."
  }
}

variable "gcp_project_id" {
  description = "GCP project ID backing the recipe site's Google OAuth"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.gcp_project_id))
    error_message = "gcp_project_id must be 6 to 30 characters long, start with a lowercase letter, end with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens."
  }
}

variable "gcp_project_name" {
  description = "Display name of the GCP project (mutable; must match the existing project on import)"
  type        = string
  default     = "recipe-site"
}

variable "gcp_region" {
  description = "Default region for GCP resources"
  type        = string
  default     = "us-east1"

  validation {
    condition     = can(regex("^[a-z]+-[a-z0-9]+[0-9]$", var.gcp_region))
    error_message = "gcp_region must be a valid GCP region name (e.g., us-east1)."
  }
}

variable "gcp_terraform_service_account_id" {
  description = "Account ID for the service account GitHub Actions impersonates to run privileged GCP Terraform"
  type        = string
  default     = "github-terraform"
}

variable "gcp_terraform_plan_service_account_id" {
  description = "Account ID for the read-only service account GitHub Actions impersonates for pull-request plans"
  type        = string
  default     = "github-terraform-plan"
}

variable "gcp_github_workload_identity_pool_id" {
  description = "Workload Identity Pool ID for GitHub Actions"
  type        = string
  default     = "github-actions"
}

variable "gcp_github_workload_identity_provider_id" {
  description = "Workload Identity Pool Provider ID for privileged GCP Terraform"
  type        = string
  default     = "personal-site"
}

variable "gcp_github_workload_identity_plan_provider_id" {
  description = "Workload Identity Provider ID for pull-request bootstrap Terraform plans"
  type        = string
  default     = "personal-site-plan"
}

variable "gcp_terraform_service_account_roles" {
  description = "Project-level roles granted to the privileged GCP Terraform service account"
  type        = set(string)
  default = [
    "roles/browser",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
  ]
}

variable "gcp_terraform_plan_service_account_roles" {
  description = "Project-level read-only roles granted to the pull-request Terraform plan service account"
  type        = set(string)
  default = [
    "roles/browser",
    "roles/iam.securityReviewer",
    "roles/iam.serviceAccountViewer",
    "roles/iam.workloadIdentityPoolViewer",
    "roles/serviceusage.serviceUsageViewer",
  ]
}
