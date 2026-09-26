# Infrastructure

Terraform configuration for managing Cloudflare, Neon, and PostHog resources.

Foundational IAM and identity trust resources live in
[`../bootstrap`](../bootstrap/README.md). Keep that root separate
from routine Cloudflare, Neon, PostHog, and Pages deploys because its GitHub
identity can change project IAM.

## GitHub Actions Setup

### Required Secrets

**[Doppler](https://doppler.com) is the single source of truth for these
values.** GitHub environment secrets and variables are populated manually from
Doppler with `scripts/sync-doppler-github-envs.sh` because the free Doppler plan
does not provide enough sync integrations for this repo's environment
boundaries. Do not edit GitHub environment values by hand; change Doppler, then
run the manual sync script.

Secrets and config mirrored from Doppler:

1. **`CLOUDFLARE_API_TOKEN`**
   - Account-owned token: `personal-site-terraform`
   - Create at: Cloudflare Dashboard → Manage Account → Account API Tokens
   - Store only in Doppler `dev_infra` and `prd_infra`.
   - Required permissions:
      - Account.Cloudflare Pages: Edit
      - Account.Account Settings: Read
      - Account.Workers R2 Storage: Edit
      - Account.Hyperdrive: Edit
      - Account.Account Rulesets: Edit
      - Account.Access Apps: Read
      - Account.Access Organizations: Read
      - Account.Access Policies: Edit
      - Account.Access: Service Tokens: Edit
      - Zone.DNS: Edit, scoped to `robbiepalmer.me`
      - Zone.Cache Settings: Edit, scoped to `robbiepalmer.me`
      - Zone.Transform Rules: Edit, scoped to `robbiepalmer.me`
   - Do not reuse this token for Pages/Workers deployment or AI-review.
2. **`TF_API_TOKEN`**
   - Create at: Terraform Cloud → User Settings → Tokens
   - Used for remote state management
   - Note: Stored as `TF_API_TOKEN` in GitHub, but workflows map it to `TF_TOKEN_app_terraform_io` for Terraform CLI
3. **`CF_IMAGES_ACCOUNT_HASH`**
   - Find at: Cloudflare Dashboard → Images → Delivery URL
   - Example: `AbCdEfGh123` (from `https://imagedelivery.net/AbCdEfGh123/...`)
   - Used to configure Cloudflare Images environment variable for deployments
   - Note: Publicly visible in image URLs; stored as a secret for consistency
4. **`NEON_API_KEY`**
   - Create at: [Neon Console](https://console.neon.tech) → Account Settings → API Keys
   - Used by the Neon Terraform provider to manage database resources
5. **`NEON_ORG_ID`**
   - Find at: [Neon Console](https://console.neon.tech) → Organization settings
   - Passed as `TF_VAR_neon_org_id`
6. **`POSTHOG_KEY`**
   - PostHog project API key (`phc_…`). This public, write-only ingestion key
     already ships to browsers via `NEXT_PUBLIC_POSTHOG_KEY`. Source it from
     Doppler to keep configuration in one place.
   - Mapped to `TF_VAR_posthog_key` (Terraform → Pages Functions and UI) and
     deployed as a secret to both recipe Workers for direct OTLP tracing.
     It is **also** used, outside Terraform's reach, as the auth header on
     the `posthog-logs` Workers Observability destination. See
     [Rotating `POSTHOG_KEY`](#rotating-posthog_key).
7. **`POSTHOG_HOST`**
   - PostHog application host (`https://eu.posthog.com`).
   - Mapped to `NEXT_PUBLIC_POSTHOG_HOST` for the UI build.
8. **`POSTHOG_OTLP_BASE_URL`** (optional)
   - Regional OTLP ingestion origin (default: `https://eu.i.posthog.com`).
   - Mapped to `TF_VAR_posthog_otlp_base_url`; the same default is declared in
     both Worker Wrangler configs and checked for drift in tests.
9. **`MISE_GITHUB_TOKEN`**
   - GitHub token used by mise to download tools during Cloudflare Pages builds.
   - Mapped to `TF_VAR_github_token`, which Terraform passes into the encrypted
     Pages build secrets (`var.github_token`, required, no default).
10. **`POSTHOG_API_KEY`**
    - Create at: PostHog → Settings → Personal API keys
    - Required scopes:
      - `dashboard:read`
      - `dashboard:write`
      - `insight:read`
      - `insight:write`
      - `logs:read`
      - `logs:write`
    - Used by the PostHog Terraform and REST providers
11. **`POSTHOG_PROJECT_ID`**
    - Find in the PostHog project/environment settings or API URLs
    - Passed as `TF_VAR_posthog_project_id`
    - Mark unmasked in Doppler so the GitHub sync publishes it as an Actions
      variable, not a secret. Terraform requires a non-empty value and has no
      production default.
12. **`CF_PAGES_PREVIEW_ACCESS_APPLICATION_ID`**
    - Find in: Cloudflare Zero Trust → Access → Applications → the Pages
      preview application → application overview or URL
    - Mark unmasked in Doppler because it identifies a public resource
    - Passed as `TF_VAR_cloudflare_pages_preview_access_application_id`

### Required Environment

Create GitHub environments that match the Doppler config boundaries:

1. Go to: Settings → Environments → New environment
2. Create `production-infra`, `production-infra-bootstrap`, `production-site-ui`,
   `production-recipe-api`, `production-recipe-ingest`,
   `production-database-backup`, `production-ci`, `preview-site-ui`,
   `preview-recipe-api`, and `preview-agent-access`
3. (Optional) Add protection rules for production deployments

PR infrastructure uses the `preview-*` environments with least-privilege
credentials. Follow the
[preview environment runbook](../docs/preview-environments.md); do not copy the
production Cloudflare token or production database URL into them.
`preview-agent-access` is used only by trusted default-branch workflows to
rotate the coding-agent Access secret and issue short-lived preview QA
credentials. Restrict it to the default branch and follow the same runbook.

### Terraform Cloud Workspace

Create a workspace in Terraform Cloud for remote state:

1. Go to: [Terraform Cloud workspaces](https://app.terraform.io/app/robbie-palmer/workspaces)
2. Create a new workspace named: `personal-site`
3. Choose "API-driven workflow"

## Local Development

Credentials are sourced from Doppler, the same single source of truth CI uses.
Run Terraform through mise; `infra/public-platform/scripts/doppler-terraform-env` injects
`dev_pages_env` and `dev_infra`, then maps readable Doppler names to
Terraform's expected `TF_VAR_*` and provider environment variables. A local
`.env` file is no longer required for normal development.

Then run Terraform commands via mise:

- `mise run //infra/public-platform:plan` - Preview changes
- `mise run //infra/public-platform:apply` - Apply changes

See `mise.toml` for all available tasks.

## R2 Buckets

### `map-tiles`

Public bucket serving map tile images via `tiles.robbiepalmer.me`.
Has DNS records, cache rules, and proxied access configured in Terraform.

### `dvc`

Private bucket for ML pipeline data versioned with [DVC](https://dvc.org/).
Accessed only via S3-compatible API with credentials. No public access.
Used by `ml-pipelines/` projects, each under their own prefix
(e.g. `s3://dvc/recipe-parsing`).

To create an API token for access:
[Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview) →
Manage R2 API Tokens → Create User API Token
(Object Read & Write, scoped to `dvc` bucket).

See [`ml-pipelines/README.md`](/ml-pipelines/README.md) for developer setup.

### `personal-site-database-backups`

Private bucket for age-encrypted PostgreSQL custom-format archives. Terraform
creates the bucket with deletion protection; the scheduled backup and restore
runbook lives in [`../backups/README.md`](../backups/README.md).

### `personal-site-workspace-backups`

Private bucket for restic-encrypted snapshots of the remote operator
workspace. Terraform prevents bucket deletion. The host uses an R2 Object Read
& Write token scoped only to this bucket, while restic applies snapshot
retention and encrypts both data and metadata before upload. The backup,
restore, status, and credential-safe export runbook lives in
[`../../homelab/README.md`](../../homelab/README.md#updates-rollback-and-backups).

## PostHog

PostHog dashboards and insights are managed in Terraform via the official
`PostHog/posthog` provider. The live project inventory is captured in
`posthog_resources.json`, with `posthog.tf` converting that data into
Terraform-managed dashboard and insight resources.

Recipe product-growth resources live separately in
`posthog_plg_resources.json` and are merged into the same Terraform resources.
The `Recipe product growth` dashboard uses these definitions:

- **Activation:** an authenticated user finishes cooking a recipe or completes
  an app-assisted shop within 30 days of starting onboarding. Completing setup
  or storing recipes is not treated as value received.
- **Time-to-value:** elapsed time from onboarding start to the first completed
  cook or app-assisted shop.
- **Active user:** a person performs `recipe_product_used`, emitted for recipe
  viewing, cook mode, meal planning, shopping, kitchen stock, timers, or
  completed value moments. DAU/WAU/MAU therefore exclude passive site
  pageviews. Recipe views count as engagement, but not activation or value.
- **Retention:** an activated user returns in a later week and performs any
  meaningful recipe action.
- **Usage depth:** actions per active user, feature mix, and active-day
  stickiness. The controlled `activity` property is the feature dimension.

Every recipe analytics event has `app_area=recipes` and an `environment`
property. Managed PLG insights filter to `environment=production`, keeping
local development and preview QA out of product metrics.

Production log-alert definitions are managed in `posthog_alerts.tf`. PostHog's
official provider currently supports insight alerts but not the separate Logs
Alert API, so these use the `Mastercard/restapi` provider until first-class
support is available. The alerts cover error/fatal logs for `recipe-pages`,
`recipe-api`, and `recipe-ingest`; application errors recorded on traces also
emit a correlated error log and are therefore covered by the same alerts.

PostHog log-alert notification destinations are managed in the PostHog UI.
The API models each Slack, Teams, or webhook destination as a group of internal
Hog functions and does not expose a stable destination resource that Terraform
can safely reconcile. After the first apply, attach at least one destination to
each alert; an alert without a destination records state but sends no
notification. Editing the alert definition itself in the UI will be reverted
by Terraform.

### Managed PostHog Resources

- Existing dashboards in project `123162`
- Existing insights in project `123162`, including their dashboard attachments
- Production log alerts for the recipe Pages Function, API Worker, and ingestion
  Workflow

### Importing PostHog Resources

The dashboards and insights in `posthog_resources.json` have already been
imported into Terraform Cloud state. For future resources, add the resource to
`posthog_resources.json`, import it once, then commit the updated inventory:

```bash
terraform import 'posthog_dashboard.managed["<stable-key>"]' '<project-id>/<dashboard-id>'
terraform import 'posthog_insight.managed["<stable-key>"]' '<project-id>/<insight-id>'
```

After import, `mise run //infra/public-platform:plan` should show no PostHog changes. Do not
edit managed dashboards or insights in the PostHog UI without also updating
`posthog_resources.json`, because Terraform will treat that as drift.

## Cloudflare Notifications

Cloudflare notification policies are managed in `cloudflare_alerts.tf` and
deliver to the shared `#production-alerts` Slack channel through a
`cloudflare_notification_policy_webhooks` destination. The Slack incoming
webhook URL is a sensitive variable (`slack_webhook_url`) sourced from Doppler
(`CLOUDFLARE_SLACK_WEBHOOK_URL` in `dev_infra` and `prd_infra`) and mapped by
`scripts/doppler-terraform-env`.

The managed policies cover major/critical Cloudflare incidents affecting
Pages, Workers, R2, SSL, and DNS; expiring Access service tokens; Universal
SSL certificate events; and an R2 storage usage threshold. The account's
auto-created budget email alert remains in place.

All five notification policies, including Pages deployment failures, are
Terraform-managed in `cloudflare_alerts.tf`. The Pages `event` and
`environment` filter values use undocumented uppercase enums
(`EVENT_DEPLOYMENT_FAILED`, `ENVIRONMENT_PRODUCTION`); the API rejects every
other casing, so these were captured from the dashboard-created policy.
Mechanism IDs must be passed undashed because the alerting API normalizes
destination UUIDs, and each `webhooks_integration` block repeats the
destination `name` so the provider's set hash matches its read-back.

Test the destination after material changes via Notifications → Destinations →
Webhooks → Send test; the message should reach `#production-alerts`.

## Neon Database

### `recipes`

Serverless Postgres project for the recipe site. Managed via the
[kislerdm/neon](https://registry.terraform.io/providers/kislerdm/neon/latest/docs)
Terraform provider.

- **Region:** `aws-us-east-1`
- **Connection:** Use the pooled connection URI (`neon_connection_uri_pooler` output)
  for serverless/Workers environments

### `recipes-preview`

Synthetic-only Postgres project for pull request previews. Its empty
`preview-base` branch is the parent of disposable PR branches. Terraform also
creates a project-scoped API key for GitHub branch automation; publish the
`neon_preview_project_id` and sensitive `neon_preview_api_key` outputs to the
`stg_recipe_api` Doppler config as `NEON_PROJECT_ID` and `NEON_API_KEY`, then run
`scripts/sync-doppler-github-envs.sh`.

## Rotating `POSTHOG_KEY`

`POSTHOG_KEY` lives in Doppler. It is used by browser analytics, direct
OTLP/protobuf trace and correlated-log export from Pages/Workers, and the
Cloudflare native-log fallback. All direct exporters are automated; the
Cloudflare observability destination remains manual. Rotate in this order:

1. **Doppler**. Update the value. This is the source of truth.
2. **GitHub environments**. Run `scripts/sync-doppler-github-envs.sh`. The
   next infra apply sets both the browser and Pages Function values; the API
   and ingestion deploy workflows write the same key as a Worker secret.
3. **Deploy the three runtimes**. Apply Terraform for Pages, then redeploy
   `recipe-api` and `recipe-ingest`. Direct trace/log export now uses the new
   key everywhere.
4. **`posthog-logs` Workers Observability destination** (manual step).
   Cloudflare Dashboard → Workers & Pages → Observability → Telemetry →
   `posthog-logs` → update the `Authorization: Bearer <phc_…>` header. Neither
   Terraform nor Doppler can reach this: there is a Cloudflare API for
   observability destinations, but the Terraform resource
   (`cloudflare_workers_observability_destination`) is currently
   [unimplemented](https://github.com/cloudflare/terraform-provider-cloudflare/issues/7127),
   and it is not a Worker secret or Pages var that the manual GitHub sync
   manages.

This destination is referenced by both Worker Wrangler files
(`[observability.logs]`) and provides platform invocation logs and a fallback
copy of console output. Application traces and their correlated logs do not
use it: `packages/observability` sends OTLP/protobuf directly to PostHog because
Cloudflare's native OTLP exporter currently cannot export PostHog traces.

## PostHog Distributed Tracing

The recipe stack propagates standard W3C `traceparent`/`tracestate` context
across:

1. `recipe-pages` (the same-origin Pages Function proxy)
2. `recipe-api` (the Cloudflare API Worker)
3. `recipe-ingest` (the Cloudflare Workflow and its durable steps)

The browser also adds `posthogDistinctId` and `sessionId` correlation data to
same-origin API requests, so backend logs can link back to the affected person
and session replay. The workflow emits a span for each durable ingestion step,
including extraction, normalization, canonicalization, persistence, and
finalization.

`posthog_otlp_base_url` selects the regional ingestion origin and defaults to
`https://eu.i.posthog.com`. Traces go to `/i/v1/traces`; correlated logs go to
`/i/v1/logs`. Both authenticate with the project token. Never use the PostHog personal API key.

PostHog distributed tracing is currently alpha. Cloudflare's own tracing/export
features are also evolving, so keep the direct exporter until Cloudflare lists
PostHog trace export as supported.
