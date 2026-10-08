# Production diagnostics

Work Graph uses Cloudflare Workers Logs for incident investigation and
Hyperdrive GraphQL analytics for database correlation. Run the commands from
the repository root. All diagnostic requests go to `api.cloudflare.com`.

## Diagnostic access

The dedicated `CLOUDFLARE_DIAGNOSTICS_API_TOKEN` lives in Doppler config
`work-graph/prd_work_graph` and the GitHub `production-work-graph` environment.
See [infrastructure prerequisites](../../infra/work-graph/README.md#diagnostic-access)
for permissions and credential provisioning.

The diagnostic helper loads Doppler if the dedicated token is absent. In CI,
all required values come from environment secrets. Missing credentials, API
errors, and unexpected response schemas fail the query instead of recording
a healthy result.

## Reproduce an incident query

```sh
mise //workers/work-graph-api:diagnostics:query -- \
  --from 2026-09-30T21:00:00Z --to 2026-09-30T22:00:00Z
```

The query selects native invocation events with HTTP status `>= 500` and
`< 600`, plus structured application error records in the same time window.
The Hyperdrive query is GraphQL and lives in
[`hyperdrive-pools.graphql`](../../workers/work-graph-api/queries/hyperdrive-pools.graphql).
The diagnostic helper loads that file directly. Workers Logs uses the telemetry
API's JSON filter format, constructed in
[`diagnostics.ts`](../../workers/work-graph-api/src/diagnostics.ts).

Check GraphQL syntax, lint rules, and formatting with:

```sh
mise //workers/work-graph-api:lint:queries
```

This check also runs in API CI. It does not validate Cloudflare's remote schema;
the live diagnostic query checks API compatibility.

The GraphQL query selects Hyperdrive pool size, waiting clients, available
slots, and failed queries for the production Hyperdrive configuration over
that exact window.
Output includes sanitized application records and pool metrics. It does not
print native URLs, headers, stacks, SQL, or historical exception messages.

Match the CLI's `X-Request-Id` response header to `errors[].requestId`.
The record's `invocationId` links it to Cloudflare's native request identifier.
Use the timestamp to narrow Hyperdrive metrics around that failure and compare
waiting clients with pool capacity. Hyperdrive metrics aggregate by location;
they do not identify an individual SQL request. `workerVersion` identifies
the deployed Worker version, and `route` uses the registered route template
rather than a ticket identifier supplied in the URL.

The event query returns at most 2,000 records per selection. If `truncated`
is true, counts are lower bounds. Split the window and query again until each
result is below the limit. The default query window is the last 15 minutes.

For investigations in the Cloudflare dashboard, open Workers Observability,
filter `$metadata.service = work-graph-api`, then
`$workers.event.response.status >= 500` and `< 600`. Match the native invocation
ID to the structured record. Old records can contain raw exception messages;
avoid copying them into issues or Work Graph notes. Native invocation metadata
can also contain URLs. Keep credentials out of request URLs.

## Retention and export decision

Work Graph requires the Workers Paid plan. Cloudflare retains its Worker logs
for seven days. The Worker config explicitly enables invocation logs and a
sampling rate of 1 so normal traffic is not sampled. Cloudflare's account-wide
daily log limit can still force sampling. Hyperdrive metrics retain 31 days.
See [Workers Logs retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and [Hyperdrive metrics](https://developers.cloudflare.com/hyperdrive/observability/metrics/).

Keep Cloudflare retention for this workflow. Scheduled checks detect failures
while logs are available, and incident notes preserve request IDs, version,
classification, timestamps, and a summary of pool metrics. PostHog export adds
another credential and failure path without a current cross-service tracing
requirement. Revisit export when investigations need logs older than seven
days or a trace spanning Work Graph and another service. The shared
`observability` package can export OTLP/protobuf to PostHog if that need arises.

## Monitoring and response

`Work Graph production health` runs every 15 minutes and can run manually.
Its diagnostic window spans 30 minutes to overlap adjacent runs.
The diagnostic step exits 1 if the window contains HTTP 5XX, an application
error record, a Hyperdrive query error, or sustained waiting at pool capacity.
The capacity threshold requires average waiting clients of at least one and
peak open connections at the configured pool maximum. Brief waiting remains
in the diagnostic output. Exit 2 means the monitor itself failed. Both fail the workflow.
The smoke step runs even when diagnostics fail and checks the production
Access boundary and queue reads without changing production tickets. The deployment workflow also runs that
smoke test after every deployment.

GitHub Actions schedules can be delayed. Workflow failure notifications are
GitHub's existing notification mechanism; operators must enable notifications
for failed workflows. The checks run periodically. Use a paging service if real-time alerts become necessary.
A green run with empty metrics means no matching observations. The smoke test exercises the production API to check availability.

On a failed run:

1. Inspect which step failed. Treat diagnostic permission or schema failures
   as broken monitoring and repair them before declaring production healthy.
2. Run the incident query for the failure window. If records are truncated,
   split the window. Preserve the sanitized output in an incident note.
3. For `database_capacity`, inspect waiting clients and available pool slots.
   Check long transactions and held connections before increasing the limit.
4. For a failed smoke test, inspect its HTTP status and correlation identifier,
   then compare the deployed version with the most recent successful deploy.
5. After mitigation, run both checks manually:

   ```sh
   mise //workers/work-graph-api:diagnostics:monitor
   mise //workers/work-graph-api:smoke:production
   ```

Do not create deliberate 5XX traffic in production to test this monitor.
Regression tests cover each failure signal, sanitization, and API failures:

```sh
mise //workers/work-graph-api:diagnostics:test
mise //workers/work-graph-api:test
```
