# Work Graph GitHub observer

This Worker is the only public ingress for Work Graph. It accepts
`POST /webhooks/github`, verifies GitHub's HMAC over the raw request body,
checks the App installation and repository against explicit allowlists, and
queues the unchanged JSON payload with its delivery ID and SHA-256 digest.

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

Install the App only after Terraform has created the hostname and queues and
the Worker deployment has passed its smoke request. Until the webhook consumer
ships, the Worker retries accepted deliveries three times and moves them to
`work-graph-github-deliveries-dlq`. Keep the App inactive during that gap. The
consumer rollout must replay or drain the DLQ before activating the webhook.

## Deploy and verify

Run commands through mise:

```bash
mise run //workers/work-graph-observer:check
mise run //workers/work-graph-observer:deploy
```

The deploy task loads runtime values from Doppler, installs the three Worker
secrets, and deploys the queue producer and bounded consumer configuration.
The App ID and private key stay out of the ingress Worker. A later
reconciliation Worker can read them from the same Doppler config.

Use GitHub's recent deliveries page to redeliver one event after activation.
Expect `202` with the same `deliveryId`. Bad signatures return `401`, invalid
or oversized bodies return `400` or `413`, and repositories or installations
outside policy return `403`.

## Rotation and recovery

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
