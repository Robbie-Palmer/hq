# Personal archive infrastructure

This independently stateful Terraform root owns the private Backblaze B2
bucket used by the personal document archive backup. The matching workload is
documented under [`homelab/personal-archive-backup/`](../../homelab/personal-archive-backup/README.md).

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Private bucket, Object Lock capability, and bucket policy | This Terraform root |
| Scheduled, maintenance, and recovery application keys | The B2 CLI and their separate secret stores |
| Restic repository, retention, backup jobs, and recovery drills | `homelab/personal-archive-backup/` |

The bucket enables Object Lock at creation but has no default retention period.
Backblaze does not allow Object Lock to be disabled later. Terraform also uses
`prevent_destroy` so an ordinary plan cannot delete the bucket. Backblaze uses
SSE-B2 with AES-256 by default; this root does not replace that default with a
customer-managed encryption key.

Application-key resources are deliberately absent. The Backblaze provider
returns a new key's secret to Terraform, which would put workload and recovery
credentials in Terraform state. Use the administrative bootstrap session only
to create narrowly scoped keys with the B2 CLI, then revoke that bootstrap key.

## Credentials

The `homelab/prd_personal_archive_infra` Doppler config contains:

| Name | Purpose |
| --- | --- |
| `B2_APPLICATION_KEY_ID` | Infrastructure key ID with bucket-policy capabilities only |
| `B2_APPLICATION_KEY` | Infrastructure key secret |
| `TF_API_TOKEN` | Token for the dedicated HCP Terraform workspace |

The infrastructure key has `listBuckets`, `writeBuckets`,
`readBucketRetentions`, `writeBucketRetentions`, and `readBucketEncryption`.
It is account-scoped because a bucket-bound B2 key omits Object Lock metadata
from the bucket read used by the provider, which creates a false replacement
plan. The explicit capabilities still prevent it from reading, writing, or
deleting archive files and from deleting buckets.

## Local use

The `personal-site-personal-archive` HCP Terraform workspace stores this
root's state and uses local execution. Review the saved plan before applying:

```bash
mise run //infra/personal-archive:plan
terraform show infra/personal-archive/.planfile
mise run //infra/personal-archive:apply
```

After the first apply, copy the `s3_endpoint` output into
`homelab/prd_personal_archive_backup` as `B2_S3_ENDPOINT`. Do not copy the
infrastructure key into the backup config.
