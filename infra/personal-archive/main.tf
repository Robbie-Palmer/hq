data "b2_account_info" "current" {}

resource "b2_bucket" "personal_archive" {
  bucket_name = var.bucket_name
  bucket_type = "allPrivate"

  file_lock_configuration {
    is_file_lock_enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
