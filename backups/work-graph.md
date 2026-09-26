# Work Graph backup and recovery

The Work Graph has three complementary recovery mechanisms:

1. Neon's restore history handles recent mistakes.
2. A manually refreshed Neon snapshot provides a known-good checkpoint before
   a risky schema or data migration.
3. `.github/workflows/work-graph-database-backup.yml` keeps independent,
   client-side-encrypted PostgreSQL archives in a dedicated Cloudflare R2
   bucket.

The third layer reuses the tested recipe backup implementation without sharing
its storage boundary. The Work Graph bucket, database login, R2 token, Doppler
config, GitHub environment, workflow concurrency group, and failure issue are
all separate.

## Schedule, retention, and encryption

The workflow runs at 03:17 UTC every Sunday and supports manual dispatch. It
uploads each archive and checksum under `weekly/YYYY/MM/`, then copies the first
successful pair each month to `monthly/YYYY/MM/` without exporting the database
again.

The dedicated bucket is `work-graph-database-backups`. Its policies match the
recipe database:

- Expire `weekly/` objects after 60 days.
- Expire `monthly/` objects after 400 days.
- Lock both prefixes against deletion or overwrite for eight days.

Terraform creates the bucket with `prevent_destroy`. R2 bucket locks protect
uploaded objects from credential misuse during the lock window. Neither
control replaces the other.

`pg_dump` writes PostgreSQL custom format to standard output. The backup script
streams that output through age and writes only ciphertext to disk. It uploads
the `.dump.age` archive and its SHA-256 sidecar, then verifies both remote
object sizes. The GitHub environment contains only the public age recipient;
keep the matching private identity in a password manager and a separate
recovery location.

## One-time setup

### 1. Apply the dedicated bucket

Merge and apply the Work Graph Terraform root:

```bash
mise run //infra/work-graph:plan
mise run //infra/work-graph:apply
```

The production workflow normally applies this root after a change reaches
`main`.

The Cloudflare Terraform provider version used by this repository does not
manage R2 lifecycle or bucket-lock rules. Add them once after the bucket exists:

```bash
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lifecycle add work-graph-database-backups expire-weekly-60d weekly/ --expire-days 60 --force'
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lifecycle add work-graph-database-backups expire-monthly-400d monthly/ --expire-days 400 --force'
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lock add work-graph-database-backups lock-weekly-8d weekly/ --retention-days 8 --force'
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lock add work-graph-database-backups lock-monthly-8d monthly/ --retention-days 8 --force'
```

Verify the result:

```bash
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lifecycle list work-graph-database-backups'
doppler run --project work-graph --config prd_work_graph_infra -- bash -c \
  'mise x -- pnpm --dir workers/work-graph-api exec wrangler r2 bucket lock list work-graph-database-backups'
```

### 2. Create isolated credentials

Connect to the direct Work Graph Neon endpoint as its owner and create a
dedicated login:

```sql
CREATE ROLE work_graph_backup LOGIN PASSWORD '<generated password>';
GRANT CONNECT ON DATABASE work_graph TO work_graph_backup;
GRANT pg_read_all_data TO work_graph_backup;
```

Build `NEON_DATABASE_URL_UNPOOLED` from that role and the direct, non-pooler
endpoint. Use either `sslmode=verify-full`, or
`sslmode=require&channel_binding=require`. `pg_dump` covers the database, not
cluster-global roles, so the backup role itself is intentionally absent from
the archive.

Create a Cloudflare R2 API token with **Object Read & Write**, scoped only to
`work-graph-database-backups`. Do not reuse the recipe backup token or a broad
Terraform token. Read access is required for monthly promotion and upload
verification.

### 3. Configure the backup environment

Create Doppler config `work-graph/prd_work_graph_backup` with:

| Name | Visibility | Purpose |
| --- | --- | --- |
| `AGE_RECIPIENT` | Unmasked | Public `age1...` recipient |
| `CLOUDFLARE_ACCOUNT_ID` | Unmasked | R2 account identifier |
| `NEON_DATABASE_URL_UNPOOLED` | Masked | Direct URL for `work_graph_backup` |
| `R2_ACCESS_KEY_ID` | Masked | Work Graph bucket-scoped R2 credential |
| `R2_DATABASE_BACKUPS_BUCKET_NAME` | Unmasked | `work-graph-database-backups` |
| `R2_SECRET_ACCESS_KEY` | Masked | Work Graph bucket-scoped R2 credential |

Create GitHub environment `production-work-graph-backup` without required
reviewers, because an approval gate would block scheduled runs. Restrict it to
protected branches, then sync the config:

```bash
scripts/sync-doppler-github-envs.sh production-work-graph-backup
```

Manually dispatch **Work Graph Database Backup** and confirm that its weekly
archive and checksum exist before relying on the schedule.

## Verify and restore

Download an archive and its checksum from the same R2 prefix. Verify the
download, age authentication tag, and PostgreSQL archive structure:

```bash
sha256sum --check work-graph-<timestamp>.dump.age.sha256
AGE_IDENTITY_FILE=/secure/path/work-graph-backup-age-key.txt \
  mise run //backups:verify -- work-graph-<timestamp>.dump.age
```

Create a new, empty scratch database. Never test a restore against production.
Decrypt explicitly and restore without source ownership or privileges:

```bash
AGE_IDENTITY_FILE=/secure/path/work-graph-backup-age-key.txt \
  mise run //backups:decrypt -- \
  work-graph-<timestamp>.dump.age work-graph-<timestamp>.dump

export SCRATCH_DATABASE_URL='<direct scratch database URL>'
docker run \
  --rm \
  --interactive \
  --env SCRATCH_DATABASE_URL \
  postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193 \
  sh -c 'pg_restore --exit-on-error --no-owner --no-privileges --dbname "$SCRATCH_DATABASE_URL"' \
  < work-graph-<timestamp>.dump
```

Run this query against the scratch database and retain its output as drill
evidence:

```sql
SELECT 'work_items' AS relation, count(*) AS rows FROM work_items
UNION ALL SELECT 'work_item_hierarchy', count(*) FROM work_item_hierarchy
UNION ALL SELECT 'work_item_dependencies', count(*) FROM work_item_dependencies
UNION ALL SELECT 'work_item_contexts', count(*) FROM work_item_contexts
UNION ALL SELECT 'work_item_architecture_decisions', count(*) FROM work_item_architecture_decisions
UNION ALL SELECT 'work_item_references', count(*) FROM work_item_references
UNION ALL SELECT 'work_item_pull_requests', count(*) FROM work_item_pull_requests
UNION ALL SELECT 'pull_requests', count(*) FROM pull_requests
UNION ALL SELECT 'knowledge_scopes', count(*) FROM knowledge_scopes
UNION ALL SELECT 'knowledge_scope_relationships', count(*) FROM knowledge_scope_relationships
UNION ALL SELECT 'work_item_priority_contexts', count(*) FROM work_item_priority_contexts
UNION ALL SELECT 'events', count(*) FROM events
UNION ALL SELECT 'leases', count(*) FROM leases
UNION ALL SELECT 'notes', count(*) FROM notes
UNION ALL SELECT 'attention_requests', count(*) FROM attention_requests
UNION ALL SELECT 'attention_resolutions', count(*) FROM attention_resolutions
UNION ALL SELECT 'idempotency_keys', count(*) FROM idempotency_keys
UNION ALL SELECT 'graph_mutation_locks', count(*) FROM graph_mutation_locks
ORDER BY relation;
```

Also query a known work item from before the backup and inspect its title,
lifecycle, context, notes, dependencies, and event history. Point a local Work
Graph API instance at the scratch URL and run the CLI `show` and `list` paths.
A drill passes only when the archive restores without errors and the database
and application checks preserve the expected graph state.

Record the backup key, restore date, scratch target, PostgreSQL client version,
row-count output, application checks, and cleanup result in the Work Graph
ticket. Delete the scratch database after the evidence is recorded.
