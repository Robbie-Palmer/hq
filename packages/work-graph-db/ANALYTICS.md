# Private operational reports

Run the owner-only batch task with database credentials from the private
Work Graph Doppler configuration. It prints aggregate JSON for a private data
platform to ingest. It does not persist telemetry in Work Graph or add an HTTP
route, public page, or public artifact.

```bash
doppler run --project work-graph --config prd_work_graph -- \
  mise //packages/work-graph-db:analytics:report -- \
  2026-09-01T00:00:00Z 2026-10-01T00:00:00Z
```

Access requires `DATABASE_URL` and PostgreSQL read permission on `events`,
`work_item_priority_contexts`, and `work_item_hierarchy`. Cloudflare Access
credentials for the REST API do not grant database access. Keep report output
in private storage. Never commit a production report.

## Metric definitions

Each row groups a project, initiative, and cause for the half-open period
`[start, end)`. Scope means the current scheduling assignment at the database
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

The task reads complete relevant event history and current scope assignments
in one read-only, repeatable-read transaction. Event `sequence` is the immutable
identity and ordering key. The report watermark is the highest relevant event
sequence read, not a cursor for incremental report updates. Recompute the
whole report after late data arrives. Pre-period events establish open waits;
post-period events do not affect the result. Duplicate identities count once;
conflicting payloads for one identity fail replay.

SQL selects only state fields needed for these metrics. The query does not
read questions, notes, resolutions, prompts, tokens, model calls, private logs,
worker identities, or cost data. The projector returns aggregates only. Error
output suppresses database details. No report endpoint is registered in the
Work Graph API. Private execution telemetry belongs in a separately authorized
data platform and must not be joined into public graph records.
