# Agent Coordinator domain

Shared Agent Coordinator domain types and rules live here. Durable records are
versioned, strictly validated, and independent of provider product names.

The public API is exported from `src/index.ts`. See
`docs/compatibility-examples.md` for examples of eligibility and ranking, and
`docs/worker-adapters.md` for native-client and API-funded session controls.
See `docs/execution-telemetry.md` for the private event contract, access rules,
retention policy, and public Work Graph projection.

## Vulnerability correlation

`queryGithubVulnerability` reads the current repository identity, one Dependabot
alert, open Renovate pull requests, changed files, mergeability, check runs, and
commit statuses through the shared `GithubClient`. The returned snapshot keeps
the alert number, package, manifest, vulnerable ranges, severity, fix version,
and state. It drops response fields that the decision does not need.

`decideVulnerabilityCorrelation` matches a Renovate proposal only when its bot
identity, base repository ID, package-table entry, and changed manifest all
match the alert. It returns `use`, `repair`, `replace`, or `decline` with the
evidence used for that choice. The incident ID combines GitHub's immutable
repository ID with the Dependabot alert number, so webhook redelivery and
controller restarts address the same incident.

The decision record contains no authentication values, pull-request body, file
patch, or webhook content. The incident-ledger integration can validate and
write this record without retaining provider credentials or request text.

## Vulnerability incident ledger

`VulnerabilityIncidentLedger` creates one Work Graph item for the immutable
repository ID and Dependabot alert number. Admission writes the policy revision,
controller thread, initial decision, and any selected Renovate pull request.
Later typed events link the worker thread, agent and Renovate pull requests,
accepted commit, deployment target, validation, recovery, and attention request.
Each mutation ID derives from the incident and event identity, so webhook
redelivery and controller restart replay the same write.

GitHub pull-request, workflow, and deployment facts come from Work Graph's
existing evidence ingestion. `recordGithubObservation` accepts a fact only when
the current projection matches the repository, linked pull request, evidence
identity, state, and exact commit. The ledger has no ready-work polling method.

Call `authorizeUnattendedMerge` before an automatic merge. It links the
implementation pull request and returns a receipt only after Work Graph stores
the policy and accepted head commit. A Work Graph error throws
`UnattendedMergeBlockedError`, so callers cannot treat a thread-only decision as
merge authority.

## Vulnerability admission

`VulnerabilityControllerPolicySchema` validates the Vector controller's
checked-in webhook policy. `decideVulnerabilityAdmission` accepts only a narrow
routing record plus a fresh Dependabot alert fetched from GitHub. Webhook
signature, replay, age, and request filtering stay in T3 Code.

The controller authorization module verifies the checked-in Cedar bundle
digest, validates every policy against its schema, and denies requests that
produce Cedar diagnostics. Its actions name concrete GitHub, T3, Work Graph,
and deployment operations. Provider credentials and provider-side rules remain
separate enforcement layers, so a Cedar permit alone never guarantees that an
operation can run.

## Vulnerability evaluation

`createVulnerabilityEvaluationRecord` reduces an incident's typed ledger events
and private execution telemetry into one evaluation record. The record includes
the proposal choice, launch suppression, checks, review, merge, deployment,
validation, alert closure, recovery, attention outcomes, terminal result,
elapsed time, model request counts, and metered cost. Its terminal results keep
`no-safe-fix`, `execution-failure`, and `missing-authority` separate.

The evaluator reads private telemetry but does not copy prompts, credentials,
quota observations, account or route identifiers, free text, or unrelated
source content into the record. Its strict schema also rejects extra fields.
Event and incident identities deduplicate retries, and conflicting uses of one
identity fail instead of changing the totals.

`aggregateVulnerabilityEvaluationRecords` reports unnecessary launches, failed
rollouts, successful recoveries, human interventions, elapsed time, model use,
and cost across incidents. `reviewVulnerabilityPolicyRevisions` compares the
first-release policy with each later revision. It recommends holding expansion
when the evidence is missing, a rollout remains unrecovered, a duplicate worker
was launched, execution failed, authority was absent, or the remediation rate
fell. Otherwise it returns the concrete safety evidence behind an expansion
recommendation.

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

Session budgets retain the currency from owner policy. Metered adapters report
their provider settlement currency. When those differ, the caller must supply
a conversion with its rate, source, and observation time. The coordinator
records it with the session. Missing conversions stop the heartbeat instead of
comparing unlike amounts.

Callers supply a UUID for retryable checkpoints. Concurrent calls share one
in-flight operation. Later retries reach Work Graph with the same idempotency
key, including after a process restart. `providerFallback` retains an API
session's identity, context, and lease. Resuming with another adapter uses the
explicit handoff path and records the prior session as its predecessor.

## Private execution telemetry

`ExecutionTelemetryRecorder` emits routing decisions, provider requests,
session outcomes, waits, handoffs, and interventions as named OpenTelemetry log
events. Events correlate to the Work Graph item and fenced lease. Stable event
IDs let analytics deduplicate retries, while query helpers report outcomes,
waits, handoffs, interventions, and metered cost by currency.

The coordinator sends these events to a private OTLP destination. Access,
retention, and deletion are destination policies rather than an application
ledger. Free text is redacted before export, and `toPublicWorkEvidence` omits
session, account, route, provider, model, quota, cost, and free-text fields.
