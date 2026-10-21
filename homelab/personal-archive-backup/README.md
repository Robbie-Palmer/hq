# Personal document archive backup

This is the first, deliberately small pilot for
[ADR 023](/projects/homelab/adrs/023-restic-backblaze-personal-archive). The
`robbie-vector-gp68hx-13vh` inventory backs up `/home/robbie/Documents` on
`robbie-Vector-GP68HX-13VH`. Photos, source code, downloads, caches, and the
Mac mini's external drive are outside this profile. Add the external drive as
a separate inventory only after this pilot has completed two backups, alerted
on a forced failure, and passed an independent recovery drill.

The scheduled Backblaze key is restricted to the private bucket and the
`restic/robbie-vector-gp68hx-13vh-documents/` prefix. Grant it only `listBuckets`,
`listFiles`, `readFiles`, and `writeFiles`. Do not grant `deleteFiles`, bucket
administration, retention administration, or governance bypass. The job uses
a local `flock` and restic's `--no-lock` mode because it cannot delete lock
objects.

Keep two other keys outside the scheduled job:

- a read-only recovery key with `listBuckets`, `listFiles`, and `readFiles`;
- a maintenance key with the scheduled capabilities plus `deleteFiles`.

Restrict both keys to the same bucket and prefix. Keep the read-only key and a
copy of the restic password outside Doppler and outside the house. Do not keep
the maintenance key in the laptop credential file.

Create the bucket through the independent
[`infra/personal-archive`](../../infra/personal-archive/README.md) Terraform
root. It enables Object Lock without default retention and keeps workload key
secrets out of Terraform state. After its reviewed plan has been applied, use
the isolated administrative B2 CLI session to create the scheduled and recovery
keys with explicit capabilities. The web console's broad "Read and Write"
preset also permits deletion. Each `b2 key create` command prints its secret
only once, so capture it directly into the intended secret store or offline
recovery material.

```bash
b2 key create --bucket robbie-personal-archive \
  --name-prefix restic/robbie-vector-gp68hx-13vh-documents/ \
  robbie-vector-gp68hx-13vh-personal-archive \
  listBuckets,listFiles,readFiles,writeFiles
b2 key create --bucket robbie-personal-archive \
  --name-prefix restic/robbie-vector-gp68hx-13vh-documents/ \
  robbie-vector-gp68hx-13vh-personal-archive-recovery \
  listBuckets,listFiles,readFiles
b2 key create --bucket robbie-personal-archive \
  --name-prefix restic/robbie-vector-gp68hx-13vh-documents/ \
  robbie-vector-gp68hx-13vh-personal-archive-maintenance \
  listBuckets,listFiles,readFiles,writeFiles,deleteFiles
```

If the Backblaze web console is stuck at its human-verification page, do not
try to automate around it. If an administrative application key already
exists, the official CLI can authenticate interactively with `b2 account
authorize` and complete the key setup without the console. Creating
the first administrative key still requires a working Backblaze account path.

## Install an inventory profile

Create Doppler config `homelab/prd_personal_archive_backup` with these masked
values:

| Name | Purpose |
| --- | --- |
| `B2_S3_ENDPOINT` | Bucket region endpoint, without `https://` |
| `B2_BUCKET_NAME` | `robbie-personal-archive` |
| `B2_BACKUP_KEY_ID` | Prefix- and bucket-restricted scheduled key ID |
| `B2_BACKUP_APPLICATION_KEY` | Scheduled key secret |
| `RESTIC_PASSWORD` | Independent repository encryption password |
| `HEALTHCHECKS_PING_URL` | Daily check connected to the homelab Slack channel |

Enable Object Lock on the bucket at creation, but do not set default retention
until the first two backups and a restore work. Object Lock cannot be disabled
after it is enabled. During the retention test, use one day of governance
retention, confirm the documented maintenance failure, wait for expiry, then
confirm `forget` and `prune` work before choosing a longer period.

Install the code and user timer, then install the credentials. The first task
does not enable the timer. The credential task enables it only after every
required secret is present.

```bash
mise run //homelab:personal-archive-install -- \
  personal-archive-backup/inventories/robbie-vector-gp68hx-13vh.json
mise run //homelab:personal-archive-healthchecks-reconcile -- \
  personal-archive-backup/inventories/robbie-vector-gp68hx-13vh.json
mise run //homelab:personal-archive-credentials
mise run //homelab:personal-archive-backup
mise run //homelab:personal-archive-status
```

The scripts and tests live with this backup component under
`personal-archive-backup/`. The two profile-aware tasks accept an inventory
path; when omitted, they select `inventories/<lowercase-hostname>.json`. This
keeps the mise tasks reusable when another host or archive is added.

The daily Healthchecks.io check uses a 30-hour period and six-hour grace, so a
missing run alerts at the same 36-hour limit as the local status check. A
failed run sends a failure ping. The local status file contains no paths,
object-store endpoint, or credentials.

## Recovery and maintenance

On a clean machine, create a mode `0600` environment file containing the
read-only key as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`RESTIC_REPOSITORY`. Put the independent password in a second mode `0600`
file. Restore into an empty directory:

```bash
PERSONAL_ARCHIVE_RECOVERY_CREDENTIALS=/secure/recovery.env \
PERSONAL_ARCHIVE_RECOVERY_PASSWORD=/secure/restic-password \
  personal-archive-restore.sh /var/tmp/personal-archive-restore
```

The restore uses restic's `--verify` option, which hashes restored files and
compares them with the encrypted repository metadata. Record the snapshot ID,
restored byte count, and B2 download usage after each drill.

Maintenance is manual and defaults to a dry run. Point it at an ephemeral
environment file made from the delete-capable key. Use `--apply` only after
reviewing the dry run:

```bash
PERSONAL_ARCHIVE_MAINTENANCE_CREDENTIALS=/secure/maintenance.env \
  personal-archive-maintenance.sh
PERSONAL_ARCHIVE_MAINTENANCE_CREDENTIALS=/secure/maintenance.env \
  personal-archive-maintenance.sh --apply
```

Restic's S3 backend hides replaced objects. Configure the B2 lifecycle rule
"Keep only the last version" after the one-day Object Lock test. Retained
versions still consume storage until their retention expires.

## Evidence log

Record each live run here. Do not record credentials or full source paths.

| Check | Result |
| --- | --- |
| Inventory | 4 PDF files, 376 KiB allocated in `Documents` on 2026-10-21 |
| Local implementation drill | Two snapshots and a verified full restore passed; latest snapshot referenced 298,794 bytes |
| Initial backup | Live B2 snapshot `f40a77a6` and repository integrity check passed on 2026-10-21 |
| Incremental backup | Live B2 snapshot `93108e66` and repository integrity check passed on 2026-10-21 |
| Forced-failure alert | Healthchecks.io accepted a failure and recovery ping on 2026-10-21 |
| Live repository restore | Snapshot `93108e66` restored 4 files; restic verification and source checksum comparison passed |
| Clean-machine restore | Pending |
| Object Lock maintenance test | Pending |
| B2 stored bytes and monthly cost | 302,165 bytes across 9 live objects after two backups; below the current 10 GB free allowance |
| Restore egress | About 334 KiB for the verified live restore; independent recovery drill still pending |
