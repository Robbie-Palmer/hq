# Operational analytics reference contract

`operationalReport(events, scopes, period)` is a pure reference projection.
It accepts caller-supplied work-state events and current scope assignments and
performs no database, object-storage, or network access. The functions and
fixtures define metric semantics for the future analytical pipeline; they do
not implement a production reporting command.

[Work Graph ADR 010](../../ui/content/projects/work-graph/adrs/010-private-lake-analytics.mdx)
chooses bounded incremental extraction to private R2, DuckDB transformations,
and versioned Parquet datasets. Extractors, transformations, and report queries
will be implemented separately and must match this contract.

## Metric definitions

Each row groups a project, initiative, and cause for the half-open period
`[start, end)`. Scope means the current scheduling assignment in the supplied
snapshot, including inherited child scope. Moving a ticket moves its report
history to its current scope. This version does not claim historical scope
attribution.

| Field | Definition |
| --- | --- |
| `episodes` | Blocking attention or expired-lease intervals overlapping the period |
| `recurringWorkItems` | Tickets with more than one overlapping interval for the same cause |
| `waitMilliseconds` | Sum of overlapping interval durations clipped to the period |
| `openAtEnd` | Intervals still open immediately before the period end |
| `interventionRequests` | Attention requests recorded in the period, including nonblocking requests |
| `resolutions` | Recorded attention resolutions in the period |
| `staleTakeovers` | Expired leases ended by an explicit reclaim in the period |
| `failedHandoffProxies` | Stale takeovers where the expired lease had no durable work note |

Attention causes use fixed categories. Unknown kinds become `attention:other`.
A blocking wait starts at the request and ends at its resolution. An expired
lease wait starts at its latest recorded expiry and ends at its recorded
expired outcome. Unreclaimed expired leases remain open. Normal release,
cancellation, decomposition, and attention lease endings are not takeovers.

A missing note is a failed-handoff proxy. It cannot establish whether a note
was useful, whether another communication channel carried a handoff, or why a
worker stopped. Resolutions do not establish that a human acted. The metric
counts requests for intervention and recorded responses without inferring
private worker behavior. Simultaneous attention waits can overlap, so summed
wait time is not ticket wall-clock time.

## Replay and privacy contract

Supply complete event history and an explicit scope snapshot. Event `sequence`
is the immutable identity and ordering key. The report watermark is the
highest supplied sequence, not an extraction checkpoint. Recompute from a
complete input version after late data arrives. Pre-period events establish
open waits; post-period events do not affect period metrics. Duplicate
identities count once; conflicting payloads for one identity fail replay.

The result contains aggregates only and buckets unknown attention kinds as
`other`. This is not an ingestion redactor: callers must supply allowlisted
fields, excluding request and resolution text, note contents, worker identities,
and execution telemetry. The future exporter must enforce that boundary before
writing to private storage. A successful pure projection does not prove export
redaction, private bucket permissions, or dataset completeness.

The retained fixtures cover reordered and duplicate input, late resolutions,
renewed lease expiry, period clipping, recurrence, and aggregate output privacy.
The Parquet and DuckDB implementation must add parity and access-boundary tests
without requiring live PostgreSQL access for report execution.
