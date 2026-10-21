output "bucket_id" {
  description = "Backblaze B2 bucket identifier"
  value       = b2_bucket.personal_archive.bucket_id
}

output "bucket_name" {
  description = "Backblaze B2 bucket name"
  value       = b2_bucket.personal_archive.bucket_name
}

output "s3_api_url" {
  description = "S3-compatible API URL for this Backblaze account"
  value       = data.b2_account_info.current.s3_api_url
}

output "s3_endpoint" {
  description = "S3-compatible endpoint hostname used by restic"
  value       = trimprefix(data.b2_account_info.current.s3_api_url, "https://")
}
