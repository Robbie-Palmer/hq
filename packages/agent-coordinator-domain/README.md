# Agent Coordinator domain

Shared Agent Coordinator domain types and rules live here. Durable records are
versioned, strictly validated, and independent of provider product names.

The public API is exported from `src/index.ts`. See
`docs/compatibility-examples.md` for examples of eligibility and ranking, and
`docs/worker-adapters.md` for native-client and API-funded session controls.

## Work Graph integration

`WorkGraphCoordinator` accepts the repository's `WorkGraphClient` through a
structural port. The HTTP client remains responsible for authentication,
request retries, and Cloudflare Access origin checks. The coordinator facade
only uses ready-work and context reads plus lease-fenced claim, renewal, note,
and release operations.

Pass a validated `TaskRequirements` record when assembling or claiming work.
The resulting context package combines those requirements with the Work Graph
brief, acceptance criteria, dependencies, inherited ADRs and references, and
current notes. Records have deterministic ordering. Item counts and encoded
package size have configurable limits; the facade rejects an oversized package
instead of silently omitting context.

Lease handles retain the Work Graph lease ID and epoch. Renewal, checkpoint,
and release send both values back to Work Graph. `observeLease` distinguishes
active, expired, ended, and superseded claims so a caller can stop before a
stale worker writes more state.

## Session orchestration

`SessionOrchestrator` binds the worker and adapter to one stable session,
claimed Work Graph lease, policy snapshot, context package version, and budget.
Its heartbeat renews the lease only while the worker is healthy, authorised,
inside quota, and inside budget. A deadline, shutdown, failed client, revoked
authorisation, or exhausted limit writes a structured checkpoint to a Work
Graph note before the worker stops.

Callers supply a UUID for retryable checkpoints. Reusing that UUID returns the
same operation and relies on the Work Graph note idempotency key across process
restarts. `providerFallback` retains an API session's identity, context, and
lease. Resuming with another adapter uses the explicit handoff path and records
the prior session as its predecessor.
