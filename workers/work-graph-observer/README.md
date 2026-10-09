# Work Graph GitHub observer

This Worker is the only public ingress for Work Graph. It accepts
`POST /webhooks/github`, verifies GitHub's HMAC over the raw request body,
checks the App installation and repository against explicit allowlists, and
queues the unchanged JSON payload with its delivery ID and SHA-256 digest.
The queue consumer uses the Work Graph database through Hyperdrive to record
delivery dispositions, refresh PR snapshots, and append correlated evidence.

The Access-protected `work-graph.robbiepalmer.me` hostname remains separate.
The observer has no route or binding that can call the Work Graph API.

## GitHub App registration

Register a private, owner-only GitHub App from
[`github-app-manifest.json`](github-app-manifest.json). Check the generated App
before installing it:

- repository permissions are read-only for Actions, deployments, metadata,
  and pull requests;
- subscriptions are limited to `deployment_status`, `pull_request`, and
  `workflow_run`;
- the webhook URL is
  `https://work-graph-observer.robbiepalmer.me/webhooks/github`;
- installation access is restricted to the approved repositories.

The manifest flow returns the App ID, webhook secret, client secret, and one
private key. Write the values directly to `work-graph/prd_work_graph` as
`GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_SECRET`, and
`GITHUB_APP_PRIVATE_KEY`. Do not print the response or keep the generated PEM
in the repository. Record the selected installation IDs and repositories as
JSON arrays in `GITHUB_ALLOWED_INSTALLATION_IDS` and
`GITHUB_ALLOWED_REPOSITORIES`.

Sync the updated Doppler config to the `production-work-graph` GitHub
environment from the repository root:

```bash
scripts/sync-doppler-github-envs.sh production-work-graph
```

GitHub reserves the `GITHUB_` prefix for Actions secrets. For this Doppler
config, the sync script maps `GITHUB_*` keys to masked `OBSERVER_*` GitHub
secrets. Doppler and Worker binding names stay unchanged. The deployment step
maps those secrets back to runtime environment names and keeps the webhook
secret out of the migration and API steps.

Install the App only after Terraform has created the hostname and queues,
database migrations have completed, and the Worker deployment has passed its
smoke request. Before activating the webhook, inspect
`work-graph-github-deliveries-dlq` for deliveries retained by the old retry-only
consumer. Redeliver them from GitHub with their original delivery IDs. Confirm
their database dispositions before removing the corresponding DLQ messages.

## Deploy and verify

Run commands through mise:

```bash
mise run //workers/work-graph-observer:check
mise run //workers/work-graph-observer:deploy
```

The deploy task loads runtime values from Doppler, installs the three Worker
secrets, and deploys the queue producer and bounded consumer configuration.
It requires `WORK_GRAPH_HYPERDRIVE_ID`. Work Graph API CD deploys this Worker
after the database migration and API smoke test. Infrastructure provisioning
does not deploy the consumer independently.
The App ID and private key stay out of the ingress Worker. A later
reconciliation Worker can read them from the same Doppler config.

Use GitHub's recent deliveries page to redeliver one event after activation.
Expect `202` with the same `deliveryId`. Bad signatures return `401`, invalid
or oversized bodies return `400` or `413`, and repositories or installations
outside policy return `403`.

## Rotation and recovery

The consumer acknowledges each message only after its database transaction
commits. A failed message retries independently, up to the queue's three-retry
limit, then moves to the DLQ. Logs contain the delivery ID and disposition,
without payloads or database error details.

`external_deliveries` keeps the immutable delivery ID and digest.
`github_delivery_processing` records `processed`, `ignored`, `unmatched`, or
`failed`, with a sanitized failure code. It retains normalized unmatched facts
for diagnosis and later correlation. Incomplete workflow runs are ignored.
Failed writes roll back PR and evidence changes together and can be retried.
Repeated delivery IDs with different payload digests are rejected.

Correlation requires an explicit `implementation` PR link and an exact
repository and head or merge SHA. Merge events retry retained facts for those
commits, including deployments received before their merge event. Adding an
implementation link also reconciles matching retained facts in the link's
transaction, without requiring another webhook. Shared commits that match several PRs remain
unmatched. Branch names, titles, and arrival times never establish a link.

Provider timestamps control current projections. For equal timestamps, workflow
attempt numbers and deployment status IDs determine order; merged PR evidence
takes precedence over an unmerged snapshot. CI reruns share the workflow
run identity, so a newer failed attempt supersedes an older successful attempt.
PR snapshots preserve the accepted head and merge commit separately. Open PRs'
speculative merge SHAs are never treated as merged commits. Evidence ingestion
does not release, cancel, block, claim, or renew work and leaves completion
policy evaluation to its existing operation.

To rotate the webhook secret, set the new value in GitHub and Doppler during
one maintenance window, redeploy the Worker, then redeliver a recent event.
GitHub supports one active webhook secret, so deliveries can fail between the
two updates. Retry them from GitHub after the Worker is live.

Rotate the App private key separately. Add the new key in GitHub, replace
`GITHUB_APP_PRIVATE_KEY` in Doppler, deploy every consumer of the key, verify a
reconciliation call, then revoke the old key.

Inspect the primary queue and DLQ before retrying an incident. A repeated
delivery ID is expected and becomes the database idempotency key in the
consumer. Never edit a payload or invent a replacement delivery ID.
