# Work Graph analytics reports

Use the Work Graph analytics report task to query a complete dbt model version.
The command reads Parquet facts through DuckDB. It does not use PostgreSQL and
does not accept a PostgreSQL connection string.

## Choose a model version

Point the task at one immutable version directory. The directory must contain
`manifest.json` and every manifest-listed Parquet object. The reader rejects an
incomplete manifest, an unlisted required model, a checksum mismatch, or a row
count mismatch. It never uses a bucket or directory glob.

For a private local cache, restrict the parent directory to the operator before
copying lake objects into it. Do not place model versions in the repository, a
web root, or a shared temporary directory.

Run a report with a half-open period. The start is included and the end is
excluded.

```bash
mise //data-pipelines/work-graph-analytics:report -- \
  /private/work-graph-analytics/model-2026-10-30 \
  2026-10-01T00:00:00Z \
  2026-11-01T00:00:00Z
```

Add `--project_id` or `--initiative_id` to select the current scope snapshot.
Supplying both filters requires both to match.

```bash
mise //data-pipelines/work-graph-analytics:report -- \
  /private/work-graph-analytics/model-2026-10-30 \
  2026-10-01T00:00:00Z \
  2026-11-01T00:00:00Z \
  --project_id=work-graph \
  --initiative_id=semi-autonomous-software-development
```

## Read directly from R2

The R2 path must name one model version, for example
`r2://private-analytics/work-graph/models/model-2026-10-30`. Keep the bucket
private and give the operator read access only to the analytics prefix.

Set these variables through the operator's secret manager:

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Then pass the R2 version path to the same mise task. The reader creates a
temporary in-memory DuckDB secret. It does not persist the R2 credential.

```bash
mise //data-pipelines/work-graph-analytics:report -- \
  r2://private-analytics/work-graph/models/model-2026-10-30 \
  2026-10-01T00:00:00Z \
  2026-11-01T00:00:00Z \
  --project_id=work-graph
```

The JSON result records the dbt model version, source manifest keys and
watermark, scope snapshot, latest event timestamp, and scope capture timestamp.
It also repeats two limits on interpretation. A missing work note is only a
failed-handoff proxy, and an attention resolution does not prove a human acted.
Do not join the report to worker identities, private logs, prompts, model calls,
or other private execution telemetry.

## Production schedule and limits

The raw extractor runs hourly at minute 23 with a hard limit of 1,000 events.
The dbt publisher runs at minute 37. It downloads at most 1,000 complete raw
manifests and 512 MiB of manifest-listed input, allows 30 seconds for dbt, and
refuses a model version above 64 MiB. Its private report must finish within 30
seconds. The extraction checkpoint should stay within 2,000 events and two
hours of the source watermark. Investigate any failed publication before the
next scheduled run.

These settings come from the production window from 2026-10-29 17:45 UTC to
2026-11-01 12:15 UTC. After the legacy-note repair, eight consecutive batches
published 1,000 events each. A batch used 8 PostgreSQL reads, returned between
2,379 and 2,415 rows, transferred an estimated 388,605 to 459,435 database
bytes, wrote 269,550 to 320,499 R2 payload bytes, and took 1.239 to 9.326
seconds. The six-hour schedule left at least 6,111 events of lag. An hourly run
keeps the same per-run bound and can clear that backlog in seven successful
runs. Revisit the interval if an hourly window exceeds any stated limit.

The 1,000-manifest ceiling covers 30 days of hourly captures plus 280 retries or
bootstrap batches. At the largest observed export payload, those 720 hourly
batches would contain about 231 MiB, so the 512 MiB input ceiling retains more
than twice that measured correction-window volume.

The deterministic correction fixture ran all 11 models and 31 tests in 1.38
seconds, then reproduced the corrected publication byte-for-byte in 1.62
seconds. The corrected version was 18,571 bytes, and the private report's input
upper bound was 7,469 bytes. The 30-second dbt and report limits and 64 MiB model
ceiling leave measured headroom while stopping an unexpected scan or model
expansion. The first manual production publication supplies the production-scale
dbt, model, and report measurements before the schedule can be enabled.

The same window recorded 38 successful R2 writes, 10 successful reads, and 18
expected missing-object reads used by immutable publication checks. Storage was
2,726,279 payload bytes in 28 objects at 2026-11-01 11:50 UTC. Cloudflare's R2
GraphQL figures are operational measurements and cannot reconcile an invoice.

## Bootstrap and credentials

Provision `work-graph-private-analytics-models` through the Work Graph
Terraform root. Create three bucket-scoped credentials:

- `RAW_R2_ACCESS_KEY_ID` and `RAW_R2_SECRET_ACCESS_KEY` have Object Read on
  `work-graph-private-analytics` only.
- `MODEL_R2_ACCESS_KEY_ID` and `MODEL_R2_SECRET_ACCESS_KEY` have Object Read and
  Write on `work-graph-private-analytics-models` only.
- The report credential uses `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` with
  Object Read on `work-graph-private-analytics-models` only.

Create `CLOUDFLARE_R2_AUDIT_API_TOKEN` with account-level R2 configuration read
permission. It verifies that both the managed `r2.dev` URL and every custom
domain are disabled; it has no object or configuration write permission.

Store the pipeline values with `CLOUDFLARE_ACCOUNT_ID` in Doppler config
`work-graph/prd_work_graph_analytics`, then sync only that config to GitHub
environment `production-work-graph-analytics`. Do not add these keys to the API
runtime config. Check anonymous denial without printing an account ID or object
body:

```bash
doppler run --project work-graph --config prd_work_graph_analytics -- \
  mise //data-pipelines/work-graph-analytics:access:check
```

Run one manual bootstrap from protected `main` through the `Work Graph
analytics` workflow. A successful result names only the model version, counts,
byte totals, durations, request counts, and correction window. It does not log
raw rows or object contents. The schedule remains gated until the environment
variable `WORK_GRAPH_ANALYTICS_SCHEDULE_ENABLED` is `true`. Enable it only after
the manual run is within every operating limit and a private R2 report verifies
the published version.

## Retry and interrupted runs

Rerun the same workflow. Raw reads start only from complete manifests. The
publisher creates Parquet objects with an immutable conditional write and puts
`manifest.json` last. An identical object is accepted on retry; a different
object at the same key stops the run. The raw extractor separately validates a
complete manifest and its checksums before recovering a checkpoint write.

Do not delete an object left by an interrupted run. A missing complete model
manifest makes it invisible to report readers. Investigate a conflicting
immutable object before choosing a new model version.

## Late events and corrections

Every publication rebuilds the canonical facts and marts from the complete raw
manifest chain. A late event has a new immutable sequence, so the next source
watermark produces a new `v1-<sequence>` model version and corrects affected
wait intervals without changing an older version. Keep the previous complete
version available until the replacement passes dbt tests, manifest checksum and
row-count verification, and a private report.

## dbt failure containment

The operator reserves a local version directory, runs `dbt build`, and creates
the publication manifest only after every model and test succeeds. A dbt error
returns a fixed failure and uploads no complete model version. Repair the model
or source contract, rerun the local project check, and retry the workflow. Do
not bypass dbt tests or upload a hand-written manifest.

## Rotation and rollback

Rotate one R2 credential at a time. Create the replacement with the same single
bucket permission, update the Doppler config, sync the analytics GitHub
environment, and run a manual publication and report. Revoke the old credential
only after that proof. Rotate the report credential separately and prove one
R2 report before revocation.

To roll back a model, point report jobs at the preceding complete model version.
To roll back orchestration, disable the scheduled workflow and revert its
repository change. Raw extraction may continue because immutable raw captures
do not change the active report version. Revert the Worker cron only through a
reviewed Worker deployment. Never roll back by editing or deleting a complete
manifest.

## Retention and compaction

The correction window is 30 days, but elapsed time alone never authorises raw
deletion. `work-graph-analytics retention` reports deletion disabled. Keep all
raw input until a future canonical seed format can replace the selected raw
manifests in a full rebuild, and that replacement has passed dbt tests,
checksum and row-count verification, and a private report. Only then may a
reviewed retention change identify an exact raw cutoff and canonical model
version. This guard also prevents a model manifest from authorising PostgreSQL
pruning by itself.
