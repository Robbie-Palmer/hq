# Work Graph API

This Cloudflare Worker exposes the Work Graph REST contract from
`openapi.json`. Production traffic reaches it only through
`https://work-graph.robbiepalmer.me`, which Cloudflare Access protects with a
Service Auth policy. The Wrangler config disables `workers.dev` and preview
URLs.

## Local development

Create Doppler config `work-graph/dev_work_graph` with `DATABASE_URL`, then
run:

```bash
mise run //workers/work-graph-api:dev
```

The dev helper maps `DATABASE_URL` to Wrangler's local `HYPERDRIVE` connection
string. `.dev.vars.example` documents the fallback for a local PostgreSQL
instance. Never put a Neon URL in a committed Wrangler file.

## Production deployment

Provision the dependencies first by following
[`infra/work-graph/README.md`](../../infra/work-graph/README.md). Then sync
Doppler config `prd_work_graph` into the `production-work-graph` GitHub
environment:

```bash
scripts/sync-doppler-github-envs.sh production-work-graph
```

The config needs the values written by Terraform plus a dedicated
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for Wrangler. Give that token
Workers editor access scoped to the existing `work-graph-api` Worker. Worker
bindings do not require separate Hyperdrive access. Do not reuse the broader
infrastructure token.

Deploy in this order:

1. Apply the Work Graph Terraform root and run its state credential check.
2. Apply committed migrations to `DATABASE_URL` with
   `mise run //packages/work-graph-db:db:migrate`.
3. Run `mise run //workers/work-graph-api:deploy`.
4. Run `mise run //workers/work-graph-api:smoke:production`.

The deploy helper reads the public Hyperdrive ID from the environment and
creates a mode-0600 temporary Wrangler config. It unlinks that file on exit.
Terraform's secure helper installs the database password in Hyperdrive before
this step. The Worker has no database secret.

CI performs the same sequence after changes reach `main`. Restrict the
`production-work-graph` environment to protected branches without required
reviewers so a merge automatically runs migrations, deploys the Worker, and
smoke-tests production.

### Database request limits

The database migration sets a 5-second lock timeout, 15-second statement
timeout, and 10-second idle-in-transaction timeout on the dedicated
`work_graph_owner` role for the Work Graph database. On PostgreSQL 17 and later,
it also sets a 20-second transaction timeout. These limits sit below the CLI's
30-second request timeout. They give the Worker time to roll back an aborted
transaction and return HTTP 503 with `Retry-After: 1` instead of holding a
Hyperdrive connection until the client disconnects.

The Worker also maps transient connection capacity to HTTP 503. This includes
PostgreSQL `too_many_connections` and `cannot_connect_now`, plus Hyperdrive's
documented pool-acquisition and temporary infrastructure failures. Each 503
includes `Retry-After: 1`, an `X-Request-Id` correlation header, and the same
request ID in the JSON error. The Worker logs that ID with the request method,
path, and stable error code. It does not log database error text.

Lease claims are intentionally not replayable. If a transient database failure
occurs after a claim may have committed, the Worker returns
`claim_outcome_uncertain` without `Retry-After` and tells the caller to inspect
the work item before claiming again.

The settings belong to the database role rather than a Worker session.
Hyperdrive uses transaction pooling and does not support arbitrary per-session
state. Apply migrations before deploying the Worker, then restart the
Hyperdrive pool so every origin connection picks up the new role defaults. Run
the production smoke test afterward.

To roll back, reset `lock_timeout`, `statement_timeout`,
`idle_in_transaction_session_timeout`, and `transaction_timeout` for
`work_graph_owner` in the `work_graph` database. Restart Hyperdrive, revert the
Worker error mapping, deploy, and run the production smoke test.

```sql
ALTER ROLE work_graph_owner IN DATABASE work_graph RESET lock_timeout;
ALTER ROLE work_graph_owner IN DATABASE work_graph RESET statement_timeout;
ALTER ROLE work_graph_owner IN DATABASE work_graph
  RESET idle_in_transaction_session_timeout;
-- PostgreSQL 17 and later only:
ALTER ROLE work_graph_owner IN DATABASE work_graph RESET transaction_timeout;
```

## Client use

The CLI loads the production Doppler config automatically when its API URL is
not already set. The equivalent explicit invocation is:

```bash
doppler run --project work-graph --config prd_work_graph -- work-graph ready
```

Do not copy the Access pair into shell startup files. The CLI refuses to send
it to an origin outside `WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS` and refuses HTTP
redirects.

`GET /api/work-items` accepts `initiativeId`, `projectId`, and `parentId`
filters. `POST /api/leases` accepts the same filters when it selects the next
ticket. The service computes global priority first, then filters that order.
`PUT /api/work-items/{workItemId}/scheduling-scope` assigns an existing root
ticket to an initiative and project; descendants inherit the assignment.
`PUT /api/work-items/{workItemId}/parent` replaces the ticket's parent. Send a
null `parentId` to detach it to the graph root. The operation preserves the
ticket and its history, and rejects cycles across hierarchy and dependency
edges.

Knowledge-scope lists and relationship lists return active scopes by default.
Pass `includeArchived=true` for an audit view. Send `POST` to
`/api/knowledge-scopes/{knowledgeScopeId}/archival` to archive a scope with a
reason after checking that it schedules no open work. `DELETE` on the same URL
restores it at the median active rank. Source snapshot updates preserve the
Work Graph-owned lifecycle.

## Note history

`POST /api/work-items/{workItemId}/notes` records lease-fenced notes while work
is active. `POST /api/work-items/{workItemId}/comments` appends attributed
discussion only after release. Both forms are append-only and appear in the
notes collection. A comment does not change the work-item row, the release
event or its evidence, or any lease. Cloudflare Access rejects unauthenticated
and unauthorized requests before they reach the Worker with HTTP 401 or 403.
