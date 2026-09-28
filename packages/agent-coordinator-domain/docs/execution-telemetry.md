# Private execution telemetry

`PrivateExecutionTelemetryLedger` keeps routing operations out of the public
Work Graph. Every event identifies its Work Graph item and fenced lease, session,
policy revision, adapter version, account class, and route. Provider requests
also record the provider, model, quota observation, funding class, metered cost,
and outcome.

The ledger accepts six event types: routing decisions, provider requests,
session outcomes, waits, handoffs, and interventions. Queries return events in
timestamp order so an operator can reconstruct a routing decision. Aggregate
queries count completion, abandonment, reassignment, failure, wait, handoff,
and intervention events, and sum metered cost by currency.

## Access and secret handling

The access policy names writers, readers, and privacy administrators. Writers
can append events but cannot query them unless the policy also lists them as a
reader. Only privacy administrators can redact or delete records. The event
schema rejects unknown fields, including accidental credential fields. Free
text passes through the adapter credential redactor before storage.

`toPublicWorkEvidence` is the only supported public projection. It includes the
Work Graph item, fenced lease, adapter version, event kind, and non-sensitive
outcome. It omits the session ID, account class, route, provider, model, quota,
cost, and reasons.

## Retention and retries

The policy requires a redaction period shorter than the deletion period.
Redaction removes account, route, provider, model, detailed quota, and free-text
values while retaining attribution keys, outcomes, wait duration, and cost for
aggregate analysis. Deletion removes the whole event after the final retention
period.

Callers must reuse an event ID when retrying a write. Provider request IDs,
routing decision IDs, session outcomes, wait IDs, handoff pairs, and
intervention IDs also act as semantic deduplication keys. An exact replay is a
successful no-op. A replay with different data raises `TelemetryConflictError`.
This prevents retries from counting cost or terminal outcomes twice.
