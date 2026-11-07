variable "cleanup_complete" {
  type = bool
}

resource "terraform_data" "managed_capability" {
  count = var.cleanup_complete ? 0 : 1

  input = "provider-resource-placeholder"
}

resource "terraform_data" "profile_guard" {
  input = "legacy-validation-placeholder"
}
