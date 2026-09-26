# Work Graph CLI

`work-graph` is the installable Node.js client for the canonical Work Graph
REST API. Hey API generates its Fetch client, endpoint functions, request
types, response types, and Zod request schemas from
`workers/work-graph-api/openapi.json`. A tRPC command router composes those
generated schemas into the task-oriented CLI. trpc-cli derives argument
parsing, validation, nested commands, and help from that router, so command
inputs and help do not have separate handwritten definitions.

## Install

Build and globally install the CLI from this repository:

```sh
mise //packages/work-graph-cli:install:global
```

Node.js 22.18 or newer is required. The generated Fetch client and Zod schemas
are included in the package. The task uses the mise-managed Node runtime and
packs through a temporary directory, so it leaves no archive in the checkout.

Once installed, run the same deployment step through the CLI from anywhere
inside a current source checkout:

```sh
work-graph self-update
```

Pass `--source-directory <path>` when the checkout is elsewhere. This command
installs the code in that checkout; it does not fetch or trust an unversioned
remote artifact.

## Agent quick start

`prime` prints the current short workflow without contacting the API:

```sh
work-graph prime
work-graph ready
work-graph claim cli-8
work-graph note cli-8 --content "HTTP tests pass"
work-graph touch cli-8
work-graph release cli-8 \
  --merge-evidence https://github.com/example/work-graph/pull/8 \
  --deployment-evidence https://work-graph.example.com/health
```

Codex sessions use their thread ID as worker provenance. Other clients should
set `WORK_GRAPH_WORKER_ID` once. Commands that already name a ticket find that
worker's active lease and fencing epoch. Scripts may instead pass `--lease-id`
and `--epoch` together to avoid the lookup.

## Configure

Set the API URL in the environment or pass it before the command:

```sh
export WORK_GRAPH_API_URL=https://work-graph.example.com
work-graph queue

work-graph --api-url http://127.0.0.1:8787 queue
```

The CLI requires HTTPS except for `localhost`, `127.0.0.1`, and `[::1]`.

When `WORK_GRAPH_API_URL` is absent, an API command automatically re-runs under
the `work-graph/prd_work_graph` Doppler config. Help and `prime` do not contact
Doppler. The CLI looks in the standard Homebrew and system binary directories;
set `WORK_GRAPH_DOPPLER_BIN` to an absolute path for another installation. The
explicit form remains available for scripts:

```sh
doppler run --project work-graph --config prd_work_graph -- work-graph ready
```

Without Doppler, set the API URL and both Cloudflare Access service-token
variables when the API is protected:

```sh
export CF_ACCESS_CLIENT_ID=example.access
export CF_ACCESS_CLIENT_SECRET=secret
export WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS=https://work-graph.example.com
```

Shared runtimes that already use the generic Access variables for another
service can set `WORK_GRAPH_CF_ACCESS_CLIENT_ID` and
`WORK_GRAPH_CF_ACCESS_CLIENT_SECRET` instead. The Work Graph-specific pair
takes precedence when both pairs are present.

The allowlist accepts comma-separated exact origins. You can also repeat
`--cf-access-allowed-origin <origin>` before the command. When credentials are
present, the CLI refuses to make a request unless the API origin appears in
that allowlist. It never follows HTTP redirects. These two checks stop a changed
API URL or cross-origin redirect from receiving the Access headers. Credential
values are read only from the environment. The command parser has no credential
flags.

For the production service, Doppler supplies the URL, allowlist, and Access
pair as one unit. The CLI's fixed bootstrap config keeps those values together.

## Commands

Run `work-graph --help` for the compact command list. `queue` selects the
`ready` stage unless `--stage` or `--all` changes it. Results follow the same
priority order used by an unscoped `claim`. Lease duration defaults to 900
seconds. `claim` also reads `WORK_GRAPH_WORKER_ID` when `--worker-id` is absent.
Run `work-graph <command> --help` for schema-derived argument and option help.
`ready` is the concise form of the default `queue`; `touch <ticket>` renews its
active lease.

```sh
work-graph scope put work-graph \
  --kind project \
  --title "Work Graph" \
  --canonical-url https://robbiepalmer.me/projects/work-graph \
  --markdown-url https://robbiepalmer.me/projects/work-graph.md
work-graph scope list --kind project
work-graph scope show work-graph
work-graph scope archive work-graph --reason "Managed outside Work Graph"
work-graph scope list --all
work-graph scope restore work-graph
work-graph scope link semi-autonomous-software-development work-graph
work-graph scope links --all
work-graph scope unlink semi-autonomous-software-development work-graph
work-graph scope assign work-graph-finish-mvp \
  --initiative-id semi-autonomous-software-development \
  --project-id work-graph
work-graph create cli-8 --title "Build the TypeScript CLI" --scheduling-project-id work-graph
work-graph context put cli-8 --kind brief --content "Add typed context records"
work-graph context put cli-8 --kind acceptance_criteria --content "Claim returns stable context"
work-graph context adr cli-8 \
  --title "Use PostgreSQL for durable coordination" \
  --url https://example.com/adrs/postgresql \
  --role governing
work-graph reference put cli-8 \
  --title "Context design notes" \
  --url https://example.com/context-design
work-graph context show cli-8
work-graph pr attach cli-8 \
  https://github.com/example/work-graph/pull/8 \
  --role implementation
work-graph pr show cli-8
work-graph pr show cli-8 --full

# Low-level snapshot and link commands for automation
work-graph pr refresh \
  --repository example/work-graph \
  --number 8 \
  --url https://github.com/example/work-graph/pull/8 \
  --head-sha 0123456789abcdef0123456789abcdef01234567 \
  --state open \
  --mergeability mergeable \
  --review-decision approved \
  --check-summary success
work-graph pr link cli-8 \
  --repository example/work-graph \
  --number 8 \
  --role implementation
work-graph priority move cli-8 --above cli-9
work-graph scope move work-graph --below another-project
work-graph expedite cli-8 --reason "Production release blocker"
work-graph unexpedite cli-8
work-graph dependency add cli-8 api-7
work-graph dependency remove cli-8 api-7
work-graph reparent cli-8 work-graph-finish-mvp
work-graph detach cli-8
work-graph queue
work-graph ready
work-graph ready --project-id work-graph
work-graph queue --stage blocked --initiative-id semi-autonomous-software-development
work-graph queue --all --limit 100
work-graph critical-path
work-graph critical-path --initiative-id semi-autonomous-software-development
work-graph critical-path --project-id work-graph
work-graph critical-path --root-work-item-id work-graph-finish-mvp
work-graph critical-path --project-id work-graph --json
work-graph claim --worker-id agent-a
work-graph claim --project-id work-graph --worker-id agent-a
work-graph claim --parent-id work-graph-finish-mvp --worker-id agent-a
work-graph claim cli-8 --worker-id agent-a
work-graph show cli-8
work-graph metadata notes cli-8
work-graph metadata events cli-8 --after-sequence 120
work-graph metadata dependencies cli-8
work-graph metadata decompositions cli-8
work-graph metadata leases cli-8 --after-epoch 2
work-graph metadata attention cli-8
work-graph metadata cancellations cli-8
work-graph metadata releases cli-8
work-graph note cli-8 --content "HTTP tests pass"
work-graph touch cli-8 --lease-duration-seconds 600
work-graph renew "$LEASE_ID" --epoch 1 --lease-duration-seconds 600
work-graph release cli-8 \
  --merge-evidence https://github.com/example/work-graph/pull/8 \
  --deployment-evidence https://work-graph.example.com/health
work-graph comment cli-8 --author agent-a --content "The production check found a follow-up."
work-graph cancel cli-8
```

`dependency add` rejects self-dependencies and edges that would create a cycle
across dependency and hierarchy relationships. Both dependency mutations accept
`--idempotency-key`. Removing an edge leaves its `dependency.added` event in the
immutable event log and appends a `dependency.removed` event.

`critical-path` prints priority outcomes, blocking chains, ready leaves, active
work, stale leases, blocking attention, and claimable parallel branches. Its
default view is global. Narrow it with `--initiative-id`, `--project-id`, or an
exact `--root-work-item-id`; a root cannot be combined with scheduling-scope
filters. Pass `--json` to print the complete `/api/critical-path` response for
automation.

Use the projection to choose work and revise the plan:

1. Select the smallest useful scope. Use the global view for portfolio work,
   an initiative or project filter for an owner review, and a root filter to
   explain one exact outcome.
2. Read each blocking chain from the priority outcome to its unresolved leaf.
   A chain can follow decomposition children and explicit dependency blockers.
3. Start from the ready leaves or claimable parallel branches. Active work,
   stale leases, and blocking attention appear separately so they are not
   mistaken for new starts.
4. Confirm an unexpected result with `show`, `metadata dependencies`, and
   `metadata decompositions`. Change the stored parent, dependency, priority,
   attention, or lease state rather than editing the projection.
5. Run `critical-path` again. It is a current structural view of the stored
   graph, so a claim or graph change can alter the result immediately.

The JSON response has the same information without display formatting.
`nodes` contains each work item once with its stage, claimability, priority,
and inclusion reasons. `edges` contains the relevant decomposition and
dependency relationships. `targetOutcomeIds` identifies the selected priority
outcomes, while `blockingPaths` lists every chain to an unresolved leaf.
`readyLeafIds` and `parallelBranches` support agents that need to select work.
`blockingAttentionIds` identifies items that need a human response. A shared
blocker remains one node, while the graph retains each distinct dependency edge
and blocking path.

This command does not estimate effort, duration, or delivery dates. A
structural critical path says what blocks an outcome now. It is not a schedule
or delivery forecast.

`reparent` moves an existing ticket under another ticket. `detach` moves it to
the graph root. Both keep the ticket's identity and attached history, reject
combined waits-for cycles, and accept `--idempotency-key`.

`context put` upserts a brief or acceptance criteria by kind. `context adr`
upserts a governing or background decision by URL, and `reference put` upserts
a supplemental link by URL. `context show` uses the same deterministic order as
`claim`: local and nearest inherited text, ADRs, project and initiative mirrors,
pull requests, then supplemental references. Full records include their source
ticket and inheritance depth. Compact pull-request records omit the numeric
depth and omit the source ticket for local links. Supplemental references never
affect queue eligibility.

`pr attach` is the normal agent command. Give it a ticket, a GitHub PR URL, and
an `implementation`, `evidence`, or `related` role. It uses the authenticated
`gh` CLI to collect the current snapshot, then refreshes and links the PR in two
separate API calls. Install and authenticate `gh` before using it.

`claim`, `context show`, and `pr show` return compact PR context by default. Use
`claim --full-pr-context`, `context show --full-pr-context`, or `pr show --full`
when an audit or integration needs the stored SHA, mergeability, review
decision, source ticket, and inheritance depth.

`pr refresh` and `pr link` remain available as low-level automation commands.
`pr refresh` records the latest observed snapshot independently of any ticket
claim. Add `--draft` for draft PRs; omit `--review-decision` when GitHub has no
decision. One snapshot can link to many tickets, and `pr show` includes inherited
links. PR state and checks inform the worker but never change queue eligibility.

The `metadata` commands expose the complete stored history needed to resume or
audit one work item. Notes include their content, dependency results contain
current incoming and outgoing edges, leases retain every worker and outcome,
and attention results include resolutions. Decomposition, cancellation, and
release results come from the immutable event log. Release events include both
merge and deployment evidence.

`note` records immutable working history. It uses the ticket's active lease by
default; pass the current lease ID and fencing epoch together when a script
already has them. `comment` appends immutable discussion after release. It cannot
reopen work or change its release event, evidence, lease history, or
timestamps. A comment requires `--author` or `WORK_GRAPH_WORKER_ID`. The stored
note returns that provenance, a `post_release` kind, a null lease ID, and its
database creation time. Both kinds appear in `metadata notes`. The API rejects
comments on open or cancelled work.

Every metadata response is a JSON object with `items` and `nextCursor`.
`notes` uses a note UUID cursor and `dependencies` uses an opaque cursor.
`events`, `decompositions`, `cancellations`, and `releases` continue with
`--after-sequence`. `leases` continues with `--after-epoch`. Pass `--limit` to
any metadata command. The default page size is 50 and the maximum is 100.

`release` is the successful terminal transition. For repository-backed work,
use it only after the change is merged and deployed. The command requires
evidence for both. It does not return unfinished work to the queue.

`scope put` uses its positional ID as the stable source key. Repeating it
replaces the title, URLs, and source revision while preserving relationships
and Work Graph-owned lifecycle and scheduling position for that ID. `scope
archive` requires a reason, rejects scopes that still schedule open work, and
removes the scope from active ranking and default listings. `scope restore`
returns it to the median active rank. Pass `--all` to `scope list` or `scope
links` for an audit that includes archived scopes and their relationships.
`scope link` adds a directed relationship and rejects cycles or archived
endpoints.

`scope assign` moves an existing root ticket into a scheduling initiative and
project. Children inherit that assignment. Omit both scope flags to return the
ticket to the unscoped queue. Queue and scheduler-selected claim commands accept
`--initiative-id`, `--project-id`, and `--parent-id`; combined filters must all
match. Filtering preserves the relative global priority order. A claim that
names a ticket directly cannot also use scope filters.

Priority commands use relative anchors. `scope move` compares active
initiatives only with active initiatives and active projects only with active
projects. `priority move` compares a ticket only with tickets in the same
scheduling project. New and restored scopes start at the median. Expedites
require a reason and temporarily donate their urgency to unresolved blockers.

Decomposition accepts contract-shaped JSON arrays. The optional child claim
gets a generated lease ID unless `--claim-lease-id` supplies one.

```sh
work-graph decompose parent-1 \
  --children-json '[{"id":"child-1","title":"First child","rank":1}]' \
  --dependencies-json '[]' \
  --claim-work-item-id child-1
```

Attention has three subcommands:

```sh
work-graph attention list
work-graph attention request cli-8 \
  --kind decision \
  --question "Which deployment target should I use?"
work-graph attention resolve "$ATTENTION_ID" --resolution "Use Cloudflare Workers"
```

`create`, `note`, `comment`, `decompose`, `attention request`, and
`attention resolve` accept `--idempotency-key <uuid>`. Note and attention IDs
are generated when `--id` is absent. When a mutation has an idempotency key,
the CLI derives any missing mutation or child-lease UUID from that key.
Retrying the same command therefore sends the same request fingerprint.

## JSON and exit codes

Every completed command writes one compact JSON document to stdout. Errors
write one JSON document to stderr:

```json
{"error":{"code":"WORK_ITEM_NOT_FOUND","message":"Work item not found","status":404}}
```

Every command also accepts its complete Zod input through `--json`, which is
useful when an agent already has a structured object:

```sh
work-graph create --json '{"id":"cli-8","title":"Build the TypeScript CLI"}'
```

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Invalid arguments or unsafe configuration |
| 3 | Authentication or authorization failure, HTTP 401 or 403 |
| 4 | Resource not found, HTTP 404 |
| 5 | Work Graph state conflict, HTTP 409 |
| 6 | Request rejected, HTTP 400 or 422 |
| 7 | Work Graph server failure, HTTP 5xx |
| 8 | Network, redirect, malformed response, or other HTTP failure |

## Development

The normal build regenerates the SDK and request schemas before compiling:

```sh
mise //packages/work-graph-cli:build
```

Generate it directly after an API contract change, or run the same non-mutating
drift check used by CI:

```sh
mise //packages/work-graph-cli:openapi:generate
mise //packages/work-graph-cli:openapi:check
mise //packages/work-graph-cli:check
```

The Work Graph CI workflow runs both the API's canonical OpenAPI check and the
CLI check whenever either implementation or contract changes. CI fails when
the committed generated client or Zod schemas differ from a clean generation.
