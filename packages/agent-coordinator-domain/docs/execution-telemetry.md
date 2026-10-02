# Private execution telemetry

`ExecutionTelemetryRecorder` emits named OpenTelemetry log events. It does not
store telemetry in the coordinator's transactional database. The runtime owns
the OpenTelemetry `LoggerProvider` and chooses an OTLP exporter and private
analytics destination.

The contract covers routing decisions, provider requests, session outcomes,
waits, handoffs, and interventions. Every event identifies its Work Graph item
and fenced lease, session, policy revision, adapter version, account class, and
route. Provider requests also record provider, model, quota observation,
funding class, metered cost, and outcome.

Event names and attributes follow OpenTelemetry's event-on-log-record model.
GenAI semantic-convention attributes are used where they fit, including
`gen_ai.provider.name` and `gen_ai.request.model`. Coordinator-specific fields
use the `agent_coordinator.*` namespace. CloudEvents would add a second event
envelope without improving OTLP transport or trace correlation, so it is not
used here.

## Export and analysis

Production code uses the global OpenTelemetry logger unless a logger is
injected. The configured SDK can attach trace and span context and export over
OTLP to the existing observability pipeline. Tests inject a `LoggerProvider`
backed by the SDK's `InMemoryLogRecordExporter`; the package does not implement
its own telemetry sink.

`queryExecutionTelemetry` reconstructs typed events from exported log records,
and `executionTelemetryMetrics` derives completion, abandonment, reassignment,
failure, wait, handoff, intervention, and cost metrics. These helpers define the
expected downstream analytics behavior without prescribing a storage engine.
R2 may be added later as a cheap archive or batch-analysis destination, but it
is not the primary ingestion contract.

Callers must reuse an event ID when retrying an emission. OTLP delivery is at
least once, so downstream queries deduplicate by event ID. Identical records
collapse to one event; conflicting records with the same ID raise
`TelemetryConflictError` in the query helper.

## Privacy boundary

The event schema rejects unknown fields, including accidental credential
fields. Free text passes through the adapter credential redactor before the SDK
receives it. The OTLP endpoint and its credentials must be available only to
the coordinator runtime.

Retention, access control, and deletion belong to the private telemetry
destination. Operators should grant query access only to the owner and trusted
maintenance identities and configure expiry there. No execution telemetry is
written to Work Graph. `toPublicWorkEvidence` is the explicit public projection;
it omits session ID, account class, route, provider, model, quota, cost, and
free-text reasons.
