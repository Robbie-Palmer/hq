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
