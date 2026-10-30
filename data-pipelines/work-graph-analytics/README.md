# Work Graph analytics

This project turns complete, privacy-safe Work Graph raw manifests into versioned
Parquet facts and marts. It implements the transformation boundary in Work Graph
ADR 011 with dbt and DuckDB. It does not read PostgreSQL or retain unrestricted
event payloads.

The pipeline has three explicit gates:

1. `work-graph-analytics stage` verifies the manifest chain, object byte counts
   and SHA-256 checksums, raw schemas, row counts, event identities, scope
   snapshots, and the extraction allowlist. It emits deterministic NDJSON inputs
   for dbt.
2. `dbt build` materialises canonical event, ticket, current-scope, and
   wait-episode facts plus operator marts as Parquet. dbt tests enforce
   identities, relationships, schema versions, and source-to-model row counts.
3. `work-graph-analytics publish` writes a complete immutable version manifest
   containing the source watermark, input manifest keys, output row counts, and
   output checksums. A version directory cannot be reused.

The report reader verifies that manifest and the listed Parquet checksums before
querying the canonical facts with DuckDB. It accepts a local version directory
or an `r2://` version path, a half-open reporting period, and optional project
and initiative filters. Reports include source, scope-snapshot, and freshness
provenance along with the documented inference limits.

Run the complete local gate through mise:

```bash
mise //data-pipelines/work-graph-analytics:check
```

Operators should use the mise report task. The full local-cache and R2 procedure
is in [the analytics report runbook](../../docs/runbooks/work-graph-analytics-reports.md).

The fixture build covers reordered-by-occurrence late events, waits that cross
reporting boundaries, lease renewal, stale and still-open leases, work-note
handoff proxies, recurring waits, intervention counts, and scope reassignment.
It builds two independent model versions and compares every Parquet model by
logical rows.

Production orchestration should download only the objects named by complete R2
raw manifests into a private working directory, stage them, reserve a new version,
run dbt, and publish the generated version directory only after every test
succeeds. Upload permissions for derived models should remain separate from
raw-extractor and report-reader permissions.
