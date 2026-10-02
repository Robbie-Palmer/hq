# Neon Database Backups

This runbook covers the recipe database and its
`personal-site-database-backups` bucket. The Work Graph uses the same schedule,
retention, encryption, and restore approach with a separate bucket and
credentials. See [Work Graph backup and recovery](work-graph.md).

The production Neon database has three complementary recovery mechanisms:

1. The Free plan's six-hour restore history handles recent mistakes.
2. The single Free-plan Neon snapshot is a manually refreshed known-good
   checkpoint, especially before a risky schema or data migration.
3. This workflow keeps provider-independent, client-side-encrypted PostgreSQL
   archives in a private Cloudflare R2 bucket.

The Neon snapshot is intentionally manual. Create or refresh it before a risky
change, and do not replace the previous known-good snapshot until the change has
been validated.

## Schedule and retention

`.github/workflows/database-backup.yml` runs at 03:17 UTC every Sunday and can
also be dispatched manually. Weekly is deliberate while the project is on
Neon's Free plan: a 512 MB full export every day would use roughly 15 GB/month,
well over the plan's 5 GB public-transfer allowance. A weekly export uses
roughly 2 to 2.5 GB/month at that database-size ceiling.

The workflow writes every archive under `weekly/`. The first successful backup
of each month is copied to `monthly/` inside R2 without exporting the database a
second time. Before promotion, the script inspects the month's archive/checksum
pair, so manual retries cannot create duplicates and can fill a month whose
scheduled run failed. If a run copied the monthly archive but failed before
copying its checksum, the next run repairs that same pair from `weekly/`. The
workflow concurrency group serializes this idempotent promotion. When the
project moves to a paid Neon plan, change the cron to a daily schedule and
adjust the prefix policy if a one-day external recovery point objective is
required.

The Cloudflare Terraform provider v4 can create the bucket but cannot manage R2
object lifecycle or bucket-lock rules. Configure these once with Wrangler after
Terraform creates the bucket:

```bash
doppler run --project personal-site --config prd_infra -- bash -c \
  'mise x -- pnpm --dir workers/recipe-api exec wrangler r2 bucket lifecycle add personal-site-database-backups expire-weekly-60d weekly/ --expire-days 60 --force'
doppler run --project personal-site --config prd_infra -- bash -c \
  'mise x -- pnpm --dir workers/recipe-api exec wrangler r2 bucket lifecycle add personal-site-database-backups expire-monthly-400d monthly/ --expire-days 400 --force'
doppler run --project personal-site --config prd_infra -- bash -c \
  'mise x -- pnpm --dir workers/recipe-api exec wrangler r2 bucket lock add personal-site-database-backups lock-weekly-8d weekly/ --retention-days 8 --force'
doppler run --project personal-site --config prd_infra -- bash -c \
  'mise x -- pnpm --dir workers/recipe-api exec wrangler r2 bucket lock add personal-site-database-backups lock-monthly-8d monthly/ --retention-days 8 --force'
```

Verify both policy sets with `wrangler r2 bucket lifecycle list` and
`wrangler r2 bucket lock list`. The intended result is:

- Expire `weekly/` after 60 days.
- Expire `monthly/` after 400 days.
- Lock both prefixes against deletion or overwrite for eight days.

The bucket's Terraform resource has `prevent_destroy`, but that only protects
Terraform-driven deletion.

## Why PostgreSQL custom format

`pg_dump --format=custom` creates a PostgreSQL archive rather than a plain SQL
text file or a general-purpose ZIP file. Its table of contents lets
`pg_restore` inspect, select, and reorder objects, restore in parallel, and
apply restore-time ownership and privilege choices. Table data is compressed
by default; this workflow explicitly uses gzip level 6.

The scripts run PostgreSQL 17.10's client tools from the official PostgreSQL
container image, pinned by digest. This matches the Neon project's major
version without compiling PostgreSQL on each GitHub runner.

Custom format is not encryption. The output of `pg_dump` is streamed through
`age`, producing a `.dump.age` file before anything is uploaded to R2.

## Encryption boundary

The backup data takes this path:

```text
Neon --TLS--> GitHub runner --age encryption--> encrypted temporary file
     --TLS--> R2 ciphertext object
```

The GitHub runner necessarily sees plaintext in `pg_dump` process memory because
it is the PostgreSQL client. The script never writes a plaintext dump to disk.
R2 receives only age-encrypted ciphertext, transported inside HTTPS. Cloudflare
also encrypts the resulting object at rest, but cannot decrypt the age layer.

Only the public `AGE_RECIPIENT` is available to GitHub. Keep the corresponding
private age identity outside GitHub, Doppler, Neon, and Cloudflare so a
compromise of those services cannot decrypt historical backups.

## One-time setup

### 1. Apply the Terraform bucket

```bash
mise run //infra/public-platform:plan
mise run //infra/public-platform:apply
```

The default bucket name is `personal-site-database-backups`.

### 2. Create scoped credentials

Create a dedicated Neon login on the direct, unpooled endpoint. Use the complete
Neon connection string with either `sslmode=verify-full`, or
`sslmode=require&channel_binding=require`; the script rejects a URL that does
not authenticate its TLS connection. A minimal starting point is:

```sql
CREATE ROLE database_backup LOGIN PASSWORD '<generated password>';
GRANT CONNECT ON DATABASE recipes TO database_backup;
GRANT pg_read_all_data TO database_backup;
```

`pg_read_all_data` does not bypass row-level security. If RLS is introduced,
verify that a dump still succeeds rather than silently switching to a partial
backup. Keep schema migrations and role creation in source control. A `pg_dump`
archive covers one database and omits cluster-global roles.

Create an R2 API token with **Object Read & Write**, scoped only to
`personal-site-database-backups`. Read access is needed to detect an existing
monthly archive and for the server-side copy that preserves the first successful
backup of the month.

### 3. Generate the age key pair

Run this outside the repository and store the resulting private file in a
password manager plus a separate recovery location:

```bash
mise x age@1.3.1 -- age-keygen -o neon-backup-age-key.txt
mise x age@1.3.1 -- age-keygen -y neon-backup-age-key.txt
```

The second command prints the public `age1...` recipient. Losing the private
identity makes every encrypted backup unrecoverable.

### 4. Configure Doppler and GitHub

Create the `prd_database_backup` Doppler config with:

| Name | Visibility | Purpose |
| --- | --- | --- |
| `AGE_RECIPIENT` | Unmasked | Public `age1...` recipient |
| `CLOUDFLARE_ACCOUNT_ID` | Unmasked | R2 account identifier |
| `NEON_DATABASE_URL_UNPOOLED` | Masked | Direct URL for the read-only backup login |
| `R2_ACCESS_KEY_ID` | Masked | Bucket-scoped R2 credential |
| `R2_DATABASE_BACKUPS_BUCKET_NAME` | Unmasked | `personal-site-database-backups` |
| `R2_SECRET_ACCESS_KEY` | Masked | Bucket-scoped R2 credential |

The recipe workflow sets `DATABASE_BACKUP_LABEL=recipes`; the script keeps that
as its default for compatible manual runs.

Create the `production-database-backup` GitHub environment without required
reviewers, because approval gates would block scheduled runs. Then sync it:

```bash
scripts/sync-doppler-github-envs.sh production-database-backup
```

Apply the Terraform bucket before manually dispatching the first workflow.

## Download, verify, decrypt, and restore

Download an encrypted archive and its checksum from the private bucket, keeping
both files in the same directory. First verify its R2 transfer checksum:

```bash
sha256sum --check recipes-<timestamp>.dump.age.sha256
```

Then verify both the age authentication tag and PostgreSQL archive structure
without creating a plaintext file:

```bash
AGE_IDENTITY_FILE=/secure/path/neon-backup-age-key.txt \
  mise run //backups:verify -- recipes-<timestamp>.dump.age
```

To decrypt it explicitly:

```bash
AGE_IDENTITY_FILE=/secure/path/neon-backup-age-key.txt \
  mise run //backups:decrypt -- \
  recipes-<timestamp>.dump.age recipes-<timestamp>.dump
```

Restore only into a newly created scratch database until the archive has been
inspected:

```bash
export SCRATCH_DATABASE_URL='<direct scratch database URL>'
docker run \
  --rm \
  --interactive \
  --env SCRATCH_DATABASE_URL \
  postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193 \
  sh -c 'pg_restore --exit-on-error --no-owner --no-privileges --dbname "$SCRATCH_DATABASE_URL"' \
  < recipes-<timestamp>.dump
```

For archive format, ownership and privilege portability are `pg_restore`
choices; the corresponding `pg_dump` flags are ignored for archive output.
Perform a real scratch restore periodically. Listing an archive confirms its
structure, not that the application behaves correctly with the restored data.
