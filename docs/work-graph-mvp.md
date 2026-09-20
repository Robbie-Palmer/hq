# Work Graph MVP implementation brief

## Status

This working implementation brief records the agreed MVP behaviour so
implementation can proceed without losing the reasoning that led to it.
The project adopts the layers defined by the
[Personal Engineering Platform](../ui/content/projects/personal-engineering-platform/index.mdx)
and keeps Work Graph-specific choices in local ADRs.

## Goal

Replace Shortcut and session memory for personal agent coordination with a
headless service that can answer:

- What work is ready now?
- What is the highest-priority work within a chosen scope?
- What blocks higher-priority work?
- Which worker holds an item?
- What context should a worker start from or resume with?
- What needs human attention?

The first live plan should be the Work Graph project itself under the
semi-autonomous software development initiative.

## Smallest useful release

The MVP is useful when a worker on any machine can use a TypeScript CLI to:

1. Create and revise work items and their dependencies.
2. List the ordered ready queue globally or within a knowledge scope.
3. Atomically claim the next eligible item or a specified item.
4. Renew its lease and record notes while it works.
5. Release, cancel, decompose, or request attention on the item.
6. Recover work whose lease has gone stale.
7. Attach knowledge sources, pull requests, and supplemental references.

The MVP does not require a graphical interface or MCP server. The REST API is
the canonical interface. The CLI proves that its semantics work before an MCP
adapter exposes the same operations to more agents.

## Working architecture

The project inherits TypeScript, Zod, Cloudflare Workers, Terraform,
PostgreSQL, Neon, and PostHog from the Personal Engineering Platform. Local
ADRs record the Work Graph-specific choices:

- TypeScript service using Hono on Cloudflare Workers.
- A dedicated Neon PostgreSQL project reached through Hyperdrive.
- Drizzle schemas and committed migrations.
- Terraform for Cloudflare, Neon, DNS, Access, and secret wiring.
- An unversioned REST API under `/api`. While there is one coordinated client,
  server and CLI can change together. No URL versioning decision is needed yet.
- A TypeScript CLI installed independently from the service.
- Cloudflare Access service-token authentication for the CLI and agents.
  Human access can use a long-lived GitHub identity-provider session.
- A Node and Hono deployment behind Tailscale Serve remains the runtime escape
  route because the domain rules and PostgreSQL model do not depend on Workers.

The shared Spectral and OWASP rules live in `api-governance/`. Every Work Graph
OpenAPI contract should extend that ruleset and keep only its local exceptions
and rate-limited endpoint list in the service directory.

## Ownership boundary

The public knowledge graph remains authoritative for initiative and project
prose and their long-lived relationships.

Work Graph keeps operational mirrors so those scopes can participate in
scheduling. A mirror may contain:

- stable source key;
- kind, initially `initiative` or `project`;
- title snapshot;
- canonical page and Markdown URLs;
- source revision;
- a service-owned rank within its scope kind.

Work Graph owns the rank. Updating a title snapshot does not make it the source
of truth for project prose.

Initiatives and projects are not executable work items. An explicit work item
can represent planning or revising one when that is real work.

## Work items

Do not store `epic`, `task`, or `subtask` as fixed types. A work item has an
optional single parent and may gain, lose, or replace children as execution
changes the plan. Presentation can describe an item by its position without
making that position part of its identity.

Do not store an `execution_mode` such as `group` or `action`. Executability is
derived and reversible. An open item is claimable when:

- it has no active lease;
- it has no unresolved blocking attention request;
- its explicit dependencies and inherited ancestor dependencies are satisfied;
- it has no non-terminal direct children; and
- it matches the requested scheduling scope and filters.

This allows the same item to move through:

```text
ready -> in progress -> waiting on children -> ready -> released
```

A work item with no children can be executed. Adding children makes the parent
wait. When every direct child is released or cancelled, the parent remains
`open` in stored lifecycle and projects as `ready` for explicit synthesis,
verification, or completion. Terminating the last child never terminates the
parent automatically.

The hierarchy must remain acyclic. Reparenting retains item identity, notes,
events, and prior leases.

## Decomposition and discovery

Discovering that claimed work is larger than expected is ordinary execution.
The plan should change to reflect that discovery. One transaction should:

1. Create child work items.
2. Assign their ranks beneath the parent.
3. Add dependencies between the new or existing work items.
4. End the current lease with `decomposed` as its outcome.
5. Return the parent to open, where its children make it non-actionable.
6. Optionally claim a chosen ready child for the same worker.

The children inherit the parent's knowledge scope, relevant context, and
priority position by default. Their own ranks order them within that position.
They may override inherited context or attach new sources without copying the
parent's prose.

This is also the discovery-spike workflow. A spike either completes without
creating more work or becomes the parent of the work its findings revealed.

## Dependencies

An explicit dependency means that one work item cannot proceed until another
reaches a satisfying terminal state.

- `released` satisfies downstream dependencies.
- `cancelled` also satisfies them because cancellation means the work is no
  longer required.
- Replacement work must be a new blocker. Cancelling one item must never
  silently redirect its edges to another.
- An unfinished child blocks its parent without requiring duplicate explicit
  edges.
- A dependency attached to a parent constrains its descendants.

Graph writes must reject cycles. PostgreSQL should serialize hierarchy and
dependency edits by locking one well-known graph-mutation row with `FOR UPDATE`,
run a recursive reachability check, and write the change in the same
transaction. The check must include the effective waits-for edges from both
relationships: a parent waits for its unfinished children, and downstream work
waits for its blockers. Checking either relation alone would admit deadlocks
such as a child that depends on its own parent. Hyperdrive does not support
PostgreSQL advisory locks, and a check outside the serialized transaction can
admit a cycle through concurrent write skew.

Hierarchy and dependency records remain separate because the relationships
have different meanings even though cycle validation considers their combined
effect.

## Priority and queue projection

People author priority as contextual stack order. The service owns its numeric
storage.
Initiatives rank against initiatives, projects against projects, and tickets
against tickets in the same scheduling project. New entries start at the median.
Clients move them by saying which nearby item they belong above or below; the
service owns and may renormalise the stored integers.

The first scoring implementation must preserve these behaviours even if the
numeric formula changes after dogfooding:

- initiative, project, and ticket priority all influence the result without
  grouping whole parent subtrees;
- tickets respect their explicit project-local order;
- decomposition inherits one ticket position and graph depth adds no score;
- the highest urgency of blocked descendants propagates backwards to their
  blockers;
- a deterministic final tie-breaker produces a total order; and
- filtering by initiative, project, parent work item, or other semantic fields
  does not change relative order within the result.

The fixture-backed policy uses reciprocal-rank fusion with an offset of 10 and
equal initial influence for initiative, project, and ticket positions. A
leading ticket from a lower-ranked initiative can interleave ahead of later
tickets from a higher-ranked initiative. Missing dimensions use the
median position in their stack. Structural hierarchy rank and stable IDs break
ties.

A priority-owning ticket selects one scheduling project and one scheduling
initiative. The service fills in the initiative when the project has exactly
one initiative parent. The caller chooses when it has more than one. A
dependency blocker inherits the best effective position of any open item
waiting on it.

Expediting is a separate, reason-bearing decision ahead of normal fusion.
Expedited urgency propagates to unresolved blockers without permanently marking
them expedited. Removing the expedite removes the donated urgency. Queue
filters run after the scheduler calculates global order. Scheduler-selected
claims use the same order.

Once work is claimed, a newly higher-priority item does not pre-empt it. The
worker continues until it completes the work, cancels it, decomposes it,
requests attention, or loses a stale lease.

## Leases and workers

Claiming and starting work is one transaction. A claim request contains a
stable worker ID, optional scope filters, and optionally a specific work-item
ID. The transaction should:

1. Select an eligible item in queue order, including reclaimable stale work.
2. Lock the candidate with `FOR UPDATE SKIP LOCKED`.
3. Create the lease and a monotonically increasing lease epoch.
4. Append the claim event.
5. Return the item and its available context.

Lease renewal and every mutating worker operation must present the current
lease ID and epoch. Reclaiming stale work increments the epoch so a delayed
request from the previous worker cannot update the item.

Immutable lease history records who worked on an item, why the lease ended,
and whether a later worker resumed it.

## Attention requests and continuity

A worker requests attention after it exhausts the alternatives allowed by its
instructions. The request records a semantic kind, the question or action
needed, the requesting lease, and any useful notes or links. It should not
force a long handoff report for small work.

Opening a blocking attention request ends the execution lease with
`attention_requested` as its outcome. The work projects as `needs_attention`
while any blocking request remains unresolved. After the last blocking request
is resolved, recompute the normal readiness predicates. The item returns to
`ready` only when its dependencies are satisfied and it has no non-terminal
direct children; otherwise it projects as `blocked`.

The item becomes claimable by any worker immediately after resolution. The
lease history retains the previous worker ID, so later scheduling can prefer
continuity without reserving the work or making it unavailable to others.

The policy for choosing between a returning worker and another available
worker is deliberately deferred. The MVP must retain enough information to add
a soft preference without a schema migration.

## Stored lifecycle and derived stages

Keep stored lifecycle state small:

- `open`
- `released`
- `cancelled`

Project the operational board stage from lifecycle state plus related records:

- `blocked`, for unsatisfied dependencies or unfinished children;
- `ready`, for eligible open work;
- `in_progress`, for work with a current lease;
- `stale`, for work whose current lease has expired;
- `needs_attention`, for unresolved blocking attention;
- `released`; and
- `cancelled`.

`released` and `cancelled` are the canonical terminal work-item values shared
by stored lifecycle and projected stage. A lease may record either value as its
outcome when that lease performed the terminal transition. The lease outcome
remains immutable history rather than another source of current work-item
state.

`released` means successful completion. It never means returning unfinished
work to the queue. Repository-backed work may move to `released` only after its
change is merged and deployed. The release request must record evidence for
both. Local verification, a commit, or an open pull request is not completion.
Work that cannot reach completion stays open and uses attention, decomposition,
cancellation, or lease expiry as appropriate.

This avoids contradictory combinations such as a stored `ready` state with an
unresolved blocker. Event history explains every transition.

## Context and relationships

Ticket creation should stay cheap. Require a title. Everything else depends on
what a useful handoff means for that piece of work:

- brief;
- acceptance criteria;
- parent item;
- knowledge scopes;
- governing or background ADRs;
- pull requests;
- notes; and
- supplemental references.

A claim response orders whichever context exists. It does not require the
planner to fill every category. Present the item's own brief first, followed by
nearest parent context, ADRs, project and initiative sources, current pull
requests, and supplemental references.

Do not add arbitrary labels. Add a semantic field only when its scheduling,
workflow, or query meaning is understood.

### Pull requests

Pull requests provide typed execution context. Work-item dependencies remain
the authority for scheduling. A join can describe a PR as `implementation`,
`evidence`, or `related` and may connect one PR to several work items.

Store a refreshable snapshot including repository, number, URL, head SHA,
state, draft status, mergeability, review decision, check summary, and
observation time. Draft status or failing CI informs the worker but does not
automatically block unrelated work.

Downstream work depends on the work item associated with a PR, not directly on
the PR. A third-party or bot PR can have a small work item such as "Integrate
dependency update". Future GitHub automation may release that item after the
merge, but the MVP can rely on an explicit worker action.

Do not call GitHub while holding a database claim transaction. Refresh PR
snapshots separately and show their observation time.

## Initial records

The likely minimum relational model is:

- `knowledge_scopes`
- `knowledge_scope_relationships`
- `work_items`
- `work_item_contexts`
- `work_item_dependencies`
- `graph_mutation_locks`
- `leases`
- `notes`
- `attention_requests`
- `attention_resolutions`
- `pull_requests`
- `work_item_pull_requests`
- `references`
- `events`
- `idempotency_keys`

The schema can combine records where doing so preserves their semantics. Avoid
generic relationship and metadata bags merely to reduce the table count.

Event rows are append-only. The database rejects updates, deletes, and
truncation, and serializes event inserts until commit. A sequence cursor can
therefore advance without skipping a lower-sequence event that commits later.

## REST resources

Use nouns and the shared API-governance rules. The initial API will likely
need:

- `/api/work-items`
- `/api/work-items/{workItemId}`
- `/api/work-items/{workItemId}/decompositions`
- `/api/work-items/{workItemId}/priority-moves`
- `/api/work-items/{workItemId}/expedites`
- `/api/work-items/{workItemId}/releases`
- `/api/work-items/{workItemId}/cancellations`
- `/api/work-items/{workItemId}/notes`
- `/api/work-items/{workItemId}/contexts`
- `/api/work-items/{workItemId}/pull-requests`
- `/api/work-items/{workItemId}/references`
- `/api/dependencies`
- `/api/leases`
- `/api/leases/{leaseId}`
- `/api/leases/{leaseId}/renewals`
- `/api/attention-requests`
- `/api/attention-requests/{attentionRequestId}/resolutions`
- `/api/knowledge-scopes`
- `/api/knowledge-scopes/{knowledgeScopeId}`
- `/api/knowledge-scopes/{knowledgeScopeId}/priority-moves`
- `/api/knowledge-scope-relationships`

Creating a lease with no work-item ID means "claim the next eligible item".
Supplying the ID means "atomically claim this item if it remains eligible".

Mutation requests should support idempotency keys. Generate and commit an
OpenAPI 3.1 contract from Hono and Zod definitions, check runtime route parity,
lint it with the shared Spectral and OWASP rules, and reject unintended
breaking changes once the contract becomes stable enough to need that gate.

## Executable behaviour specification

Use Vitest scenario names and the real domain API instead of adding Cucumber
and a second layer of step definitions. Start unimplemented behaviours as
`it.todo` and turn each one into a passing test with its implementation slice.

Pure domain scenarios should cover:

- an unblocked childless item becoming ready;
- dependencies and unfinished children blocking work;
- decomposition making children actionable and the parent non-actionable;
- terminal children making their parent ready again without terminating it;
- cancellation satisfying a dependency;
- replacement work requiring a new dependency edge;
- reparenting retaining item history;
- rejection of hierarchy, dependency, and combined waits-for cycles;
- contextual rank fusion, median insertion, and blocker priority donation;
- explicit expedite donation and removal;
- stable ordering inside filtered scopes;
- sparse tickets remaining valid;
- claim context ordering only the context that exists;
- attention removal from and readiness recomputation before queue return;
- retention of the previous worker after attention resolution; and
- pull requests informing work without becoming dependency edges.

PostgreSQL integration scenarios should cover:

- two workers racing to claim one item, with exactly one winner;
- atomic selection and lease creation;
- `SKIP LOCKED` allowing workers to claim different ready items;
- stale lease reclamation;
- rejection of a delayed mutation carrying an old lease epoch;
- concurrent hierarchy and dependency edits failing to create a combined
  cycle;
- atomic decomposition with no partially created child graph; and
- idempotent retry after a lost HTTP response.
- relative priority moves remaining inside their initiative, project, or
  project-local ticket stack.

API scenarios should cover:

- global and scoped queue filters;
- specific and scheduler-selected claims;
- bounded request fields and arrays;
- shared error responses;
- authentication failures;
- route and OpenAPI parity; and
- request replay with an idempotency key.

Keep this deferred scenario visible as a pending test:

```ts
it.todo(
  "prefers the previous worker without delaying higher-priority work indefinitely",
);
```

## Build order

Each slice should leave something testable and avoid building the read-only UI
before the headless workflow is useful.

1. [x] Create a Work Graph domain package and add the scenario
   catalogue as `it.todo` tests.
2. [x] Implement lifecycle and readiness projection, hierarchy checks, and the
   first deterministic priority policy against in-memory fixtures.
3. [x] Add the PostgreSQL schema, migrations, and integration-test database.
4. [x] Persist lease history and implement atomic specified and first-eligible
   claims, renewal, stale recovery, and epoch fencing.
5. [x] Build the canonical list and readiness projection, claim, renew, release,
   and cancel endpoints with generated OpenAPI.
6. [x] Add create, dependency, note, attention, and idempotent mutation
   endpoints.
7. [x] Add transactional decomposition, including ending the current lease and
   optionally claiming a ready child.
8. [x] Build the TypeScript CLI around create, queue, claim, show, note, renew,
   decompose, attention, release, and cancel operations.
9. [x] Provision the Worker, Neon project, Hyperdrive, Access application, service
   token, and secrets through Terraform and Doppler.
10. [ ] Enter this plan into Work Graph and use it to finish its own MVP.
11. [x] Replace public numeric priority weights with contextual relative moves,
    median insertion, fixture-driven rank fusion, and explicit expedites.
12. [x] Add typed briefs, acceptance criteria, ADRs, and supplemental references
    with inherited resolution and ordered claim output across persistence, API,
    and CLI.
13. [x] Add manual PR links and snapshot refresh. Automate GitHub events only after
   manual use shows which events matter.

## Deferred

- Continuity scoring after attention resolution.
- MCP exposure.
- A public DAG view and human attention inbox UI.
- GitHub webhooks and automatic task release.
- Formal API versioning.
- Multiple owners, teams, and policy domains.

## Explicit exclusions

- Arbitrary labels.
- Delivery forecasting and estimates.
- Automatic completion of parents when their last child terminates.
- A public numeric priority scale that agents or owners must calibrate.

## MVP completion check

The MVP is complete when the deployed service and CLI can hold this project's
real plan, two workers cannot claim the same item, stale work can be recovered,
dependency and hierarchy cycles cannot enter the graph, attention can pause and
resume work without losing prior context, and the queue identifies the next
eligible work globally or within a chosen scope.
