# Secrets and Configuration

This repo uses Doppler as the source of truth for both secrets and deploy-time
configuration. Non-secret values such as `RECIPE_API_URL`,
`CF_PAGES_HOST`, and `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH` belong in Doppler too
when they are needed by CI/CD or runtime builds. Mark those values unmasked in
Doppler so the manual GitHub sync script publishes them as GitHub Actions
variables instead of encrypted secrets.

GitHub Actions secrets are write-only through GitHub's API. They can be listed,
but their values cannot be fetched back out with `gh`. Use the migration
workflow in `.github/workflows/migrate-github-env-to-doppler.yml` only with
short-lived Doppler read/write service tokens, then revoke those tokens.

## Doppler Project

The Doppler project is `personal-site`. It covers the monorepo's coupled site
and recipe runtimes because they ship as one deployed system.

Split into separate Doppler projects only when ownership, access control,
rotation cadence, or deployability diverge. Until then, separate configs inside
one project give enough structure without fragmenting the setup.

The stateful AI reviewer is the first deliberate exception. It is independently
deployable, has a GitHub App identity and inference budget unrelated to the
sites, and may eventually move to its own repository. Its secrets live in
Doppler project `ai-review`, not in `personal-site`.

## Config Layout

Configs are split by environment and runtime/control boundary:

| Config | Purpose | GitHub target |
| --- | --- | --- |
| `dev_pages_env` | Shared local Cloudflare Pages env vars | None |
| `dev_agent` | Preview-only credentials consumed by local agents and the remote operator workspace | None |
| `dev_recipe_api` | Local recipe Worker/API/DB/OAuth config | None |
| `dev_infra` | Local Terraform/provider credentials | None |
| `dev_bootstrap_infra` | Local bootstrap Terraform credentials | None |
| `stg_pages_env` | Shared PR preview runtime env vars | `preview-site-ui`, `preview-recipe-api` |
| `stg_site_ui` | PR preview UI deploy credentials | `preview-site-ui` |
| `stg_recipe_api` | PR preview Worker/API automation config | `preview-recipe-api` |
| `ops_preview_agent_access` | Access credential rotation and preview Playwright QA | `preview-agent-access` |
| `prd_pages_env` | Shared production runtime env vars | `production-site-ui`, `production-recipe-api`, `production-recipe-ingest` |
| `prd_site_ui` | Production UI deploy credentials | `production-site-ui`, `production-recipe-api`, `production-recipe-ingest` |
| `prd_recipe_api` | Production Worker/API/DB/OAuth config | `production-recipe-api` |
| `prd_recipe_ingest` | Production recipe ingest Worker LLM config | `production-recipe-ingest` |
| `prd_infra` | Production Terraform/provider credentials | `production-infra` |
| `prd_bootstrap_infra` | Production bootstrap Terraform credentials | `production-infra-bootstrap` |
| `prd_bootstrap_plan` | Read-only bootstrap Terraform plan credentials | `production-infra-bootstrap-plan` |
| `prd_database_backup` | Encrypted Neon-to-R2 backup credentials and public encryption recipient | `production-database-backup` |
| `prd_ci_repo` | Repo-wide sensitive CI like AI review and DVC | `production-ci` |
| `ai-review/stg` | Isolated live-QA deployment of the stateful AI reviewer | None |
| `ai-review/prd` | Standalone stateful AI reviewer deploy and runtime config | `production-ai-review` |

Doppler config inheritance is not available on this workspace plan, so local
full-stack dev uses nested `doppler run` calls instead of duplicating values
into a composite config.

`dev_personal` is a locked legacy catch-all config kept only as a migration
reference. The repo should not depend on it.

Cloudflare automation uses account-owned API tokens so CI/CD is not coupled to
an individual Cloudflare user. Keep these boundaries separate:

| Token | Doppler configs | Scope |
| --- | --- | --- |
| `personal-site-terraform` | `dev_infra`, `prd_infra` | Terraform-managed Pages, R2, Hyperdrive, rulesets, DNS for `robbiepalmer.me`, and preview Access resources |
| `personal-site-production-deploy` | `prd_site_ui` | Production Pages/Workers deploys plus read-only R2, Hyperdrive, and Images access |
| `ai-review-staging-deploy` | `ai-review/stg` | Staging AI-review Worker deployment and read-only R2 access |
| `ai-review-production-deploy` | `ai-review/prd` | Production AI-review Worker deployment and read-only R2 access |

Never copy the Terraform token into UI, Worker, AI-review, preview, or legacy
configs. Roll each token independently, update its owning Doppler config, sync
the mapped GitHub environments, verify the new credential, and only then revoke
the previous secret.

## Pages Functions

Pages Functions use the Cloudflare Pages project environment. Pages Functions
need no separate OAuth secret today.

The source of truth for deployed Pages Functions config is the matching
`*_site_ui` Doppler config. Terraform reads related values from `dev_pages_env`
locally, but Terraform is not the owner of the values.

Current Pages Function config:

- `RECIPE_API_URL` - production Worker origin override
- `RECIPE_API_PREVIEW_ORIGIN_TEMPLATE` - maps PR aliases to preview Workers
- `CF_PAGES_HOST` - recognizes canonical PR aliases
- `POSTHOG_API_HOST` - optional PostHog ingest proxy override
- `POSTHOG_ASSETS_HOST` - optional PostHog assets proxy override

`MISE_GITHUB_TOKEN` is deployed as the encrypted Pages secret `GITHUB_TOKEN`;
never place it in the plain-text environment-variable map.

OAuth provider secrets and `BETTER_AUTH_SECRET` belong to the recipe Worker
configs, not the Pages UI/Functions configs.

PostHog browser analytics uses `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST` at build time. Those are not high-sensitivity
secrets, but they can still live in Doppler as unmasked config and sync to
GitHub variables through `scripts/sync-doppler-github-envs.sh`.

## Naming Rules

Prefer exact environment variable names consumed by code and tools.

Exception: GitHub Actions does not allow secret names beginning with
`GITHUB_`, so GitHub-targeted configs should use:

- `OAUTH_CLIENT_ID_GITHUB`
- `OAUTH_CLIENT_SECRET_GITHUB`

Workflows map those names to the Worker runtime names:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Google OAuth can use runtime names directly:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Local Development

Start the full local stack with:

```bash
mise run //:dev
```

The root task injects both local runtime configs:

```bash
doppler run --project personal-site --config dev_pages_env -- \
  doppler run --project personal-site --config dev_recipe_api -- ...
```

`workers/recipe-api/scripts/dev.sh` maps `DATABASE_URL` to
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` so Wrangler can
emulate Hyperdrive without a `.dev.vars` file.

Required local Worker values in `dev_recipe_api`:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Terraform

Run Terraform through mise:

```bash
mise run //infra/public-platform:plan
mise run //infra/public-platform:apply
mise run //infra/bootstrap:plan
mise run //infra/bootstrap:apply
```

Normal infra tasks inject both `dev_pages_env` and `dev_infra` locally.
Bootstrap infra tasks inject `dev_bootstrap_infra`. The wrappers map readable
Doppler names to Terraform's expected names, including
`TF_TOKEN_app_terraform_io` and `TF_VAR_*`.

`dev_pages_env` owns Pages runtime values that Terraform applies to Cloudflare
Pages:

- `RECIPE_API_URL`
- `RECIPE_API_PREVIEW_ORIGIN_TEMPLATE`
- `CF_PAGES_HOST`
- `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_KEY`
- `POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_HOST`
- `CF_IMAGES_ACCOUNT_HASH` / `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`

`dev_infra` owns normal provider credentials. Terraform should not receive UI
deploy credentials or privileged GCP credentials:

- `CF_PAGES_PREVIEW_ACCESS_APPLICATION_ID` (unmasked)
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_SLACK_WEBHOOK_URL`
- `GITHUB_TOKEN` or `MISE_GITHUB_TOKEN`
- `TF_API_TOKEN`
- `NEON_API_KEY`
- `NEON_ORG_ID`
- `POSTHOG_API_KEY`
- `POSTHOG_PROJECT_ID` (unmasked; syncs to a GitHub Actions variable)

`dev_bootstrap_infra` owns foundational IAM and identity bootstrap credentials:

- `GCP_PROJECT_ID` (unmasked)
- `GCP_WORKLOAD_IDENTITY_PROVIDER` (unmasked)
- `GCP_TERRAFORM_SERVICE_ACCOUNT` (unmasked)
- `TF_API_TOKEN`

## GitHub Environments

Name GitHub environments after runtime or job boundaries:

| GitHub environment | Doppler configs | Used by |
| --- | --- | --- |
| `preview-recipe-api` | `stg_recipe_api`, `stg_pages_env` | PR preview Worker/database jobs and preview cleanup |
| `preview-site-ui` | `stg_site_ui`, `stg_pages_env` | PR preview Pages build/deploy and preview comment |
| `preview-agent-access` | `ops_preview_agent_access` | Coding-agent credential rotation and one-run preview Playwright credentials |
| `production-recipe-api` | `prd_recipe_api`, `prd_site_ui`, `prd_pages_env` | Production recipe API deploy |
| `production-recipe-ingest` | `prd_recipe_ingest`, `prd_site_ui`, `prd_pages_env` | Production recipe ingest Worker deploy |
| `production-site-ui` | `prd_site_ui`, `prd_pages_env` | Production UI CI/CD and Cloudflare Images health check |
| `production-infra` | `prd_infra` | Terraform CI/CD |
| `production-infra-bootstrap` | `prd_bootstrap_infra` | Manual bootstrap Terraform |
| `production-infra-bootstrap-plan` | `prd_bootstrap_plan` | Read-only bootstrap Terraform PR plans |
| `production-remote-development-infra` | `homelab/prd_remote_development_infra` | Manual remote-development Terraform apply |
| `production-remote-development-infra-plan` | `homelab/prd_remote_development_infra` | Remote-development Terraform PR plans |
| `production-database-backup` | `prd_database_backup` | Scheduled encrypted Neon backup |
| `production-ci` | `prd_ci_repo` | AI review and ML pipeline CI |
| `production-ai-review` | `ai-review/prd` | Stateful AI reviewer Worker deployment |

`production-infra-bootstrap-plan` must require environment approval before its
Terraform Cloud token is released. The Google identity is read-only, but the
token still permits the local Terraform process to read the bootstrap state.

The remote-development plan workflow runs automatically for same-repository
pull requests and skips forks before loading environment credentials. Require
approval on the apply environment. The source config must keep `HCLOUD_TOKEN`
and `TF_API_TOKEN` masked. Mark `SSH_PUBLIC_KEY`,
`BOOTSTRAP_SSH_CIDRS`, and `BOOTSTRAP_MODE_ENABLED` unmasked so the sync
publishes them as GitHub environment variables.

Run `scripts/sync-doppler-github-envs.sh` after any Doppler change that should
reach GitHub Actions. The script reads Doppler visibility metadata: unmasked
values become GitHub environment variables, while masked/restricted values
become GitHub environment secrets. Pass one or more GitHub environment names to
sync only those environments; omit them to sync every mapped environment.

Restrict `preview-agent-access` deployments to the default branch. Its source
config, `ops_preview_agent_access`, should contain:

- `CLOUDFLARE_ACCOUNT_ID` (unmasked)
- `CLOUDFLARE_API_TOKEN` with only Access Service Tokens Read/Edit
- `DOPPLER_AGENT_CONFIG=dev_agent` (unmasked)
- `DOPPLER_PROJECT=personal-site` (unmasked)
- `DOPPLER_SERVICE_TOKEN` with read/write access only to `dev_agent`

`dev_agent` contains only `CF_ACCESS_CLIENT_ID`,
`CF_ACCESS_CLIENT_SECRET`, and `CLOUDFLARE_PAGES_HOST`. Local agent launchers
and the remote operator workspace read this config. The remote workspace uses
its own read-only Doppler token and managed Kubernetes Secret; the pilot
workspace does not receive it. Agents must not receive `dev_infra` or
deployment credentials.

## Preview Values

`stg_recipe_api` should own:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEON_API_KEY`
- `PREVIEW_AUTH_SEED`
- `CLOUDFLARE_PAGES_HOST`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `NEON_PROJECT_ID`

`stg_pages_env` should own shared preview runtime config:

- `CF_IMAGES_ACCOUNT_HASH`
- `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`
- `CLOUDFLARE_PAGES_HOST`
- `CF_PAGES_HOST`
- `RECIPE_API_URL`
- `RECIPE_API_PREVIEW_ORIGIN_TEMPLATE`
- `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` if preview analytics are enabled
- `POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_HOST` if preview analytics are enabled

`stg_site_ui` should own preview UI deploy credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The preview workflow derives per-PR `BETTER_AUTH_SECRET`,
`PREVIEW_AUTH_PASSWORD`, and `DATABASE_URL`, then uploads those to the isolated
preview Workers with `--secrets-file`. `stg_recipe_api` also supplies a
spend-limited `OPENROUTER_API_KEY` so recipe imports can be QA'd end to end.

## Production Values

`prd_recipe_api` should own:

- `BETTER_AUTH_SECRET`
- `NEON_DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_CLIENT_ID_GITHUB`
- `OAUTH_CLIENT_SECRET_GITHUB`

`prd_recipe_ingest` should own:

- `OPENROUTER_API_KEY`

`prd_pages_env` should own shared production runtime config:

- `CF_IMAGES_ACCOUNT_HASH`
- `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`
- `POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `POSTHOG_HOST`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `RECIPE_API_URL`
- `RECIPE_API_PREVIEW_ORIGIN_TEMPLATE`
- `CF_PAGES_HOST`

`prd_site_ui` should own production UI deploy credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The sync script includes `prd_site_ui` and `prd_pages_env` when publishing the
production recipe environments. Worker deploy jobs therefore reuse the shared
Cloudflare deploy token and PostHog runtime settings without duplicating them
into each service-specific Doppler config.

`prd_infra` should own:

- `CF_PAGES_PREVIEW_ACCESS_APPLICATION_ID` (unmasked; syncs to a GitHub Actions variable)
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_SLACK_WEBHOOK_URL`
- `CF_IMAGES_ACCOUNT_HASH`
- `POSTHOG_KEY`
- `MISE_GITHUB_TOKEN`
- `NEON_API_KEY`
- `NEON_ORG_ID`
- `POSTHOG_API_KEY`
- `POSTHOG_PROJECT_ID` (unmasked; syncs to a GitHub Actions variable)
- `TF_API_TOKEN`

Rotate `CLOUDFLARE_SLACK_WEBHOOK_URL` by creating a replacement webhook URL in
the Slack app, setting the new value in both `dev_infra` and `prd_infra`,
running `scripts/sync-doppler-github-envs.sh production-infra`, then running
`mise run //infra/public-platform:plan` and applying the destination update. Verify the new
URL by sending a test through Cloudflare Notifications → Destinations →
Webhooks before deleting the old webhook from the Slack app.

`prd_bootstrap_infra` should own:

- `GCP_PROJECT_ID` (unmasked)
- `GCP_WORKLOAD_IDENTITY_PROVIDER` (unmasked)
- `GCP_TERRAFORM_SERVICE_ACCOUNT` (unmasked)
- `TF_API_TOKEN`

`prd_bootstrap_plan` should own:

- `GCP_PROJECT_ID` (unmasked)
- `GCP_WORKLOAD_IDENTITY_PROVIDER` (unmasked; PR-only provider)
- `GCP_TERRAFORM_SERVICE_ACCOUNT` (unmasked; read-only plan identity)
- `TF_API_TOKEN`

`prd_database_backup` should own:

- `AGE_RECIPIENT` (unmasked; public age recipient, never the private identity)
- `CLOUDFLARE_ACCOUNT_ID` (unmasked)
- `NEON_DATABASE_URL_UNPOOLED`
- `R2_ACCESS_KEY_ID`
- `R2_DATABASE_BACKUPS_BUCKET_NAME` (unmasked)
- `R2_SECRET_ACCESS_KEY`

The Neon URL should use a dedicated read-only backup role, the direct unpooled
endpoint, and either `sslmode=verify-full` or
`sslmode=require&channel_binding=require`. Scope the R2 Object Read & Write
token to only the database backup bucket. The private age identity must not be
stored in Doppler or GitHub; keep it in a password manager plus a separate
recovery copy.

`prd_ci_repo` should own:

- `OPENROUTER_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `SONAR_TOKEN`

This OpenRouter key is for repo-wide CI, such as AI review and ML pipeline
jobs. Recipe ingestion uses the separate key in `prd_recipe_ingest` so its
budget and limits can be managed independently.

The standalone Doppler project `ai-review`, config `prd`, should own:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID` (unmasked)
- `AI_REVIEW_APP_ID` (unmasked)
- `AI_REVIEW_APP_INSTALLATION_ID` (unmasked)
- `AI_REVIEW_APP_PRIVATE_KEY`
- `AI_REVIEW_WEBHOOK_SECRET`
- `OPENROUTER_API_KEY`
- `OPENCODE_API_KEY` (optional while anonymous free-model access is available)

The GitHub App is installed only on `Robbie-Palmer/hq`. Its App ID
and installation ID are identifiers, while its private key and webhook secret
must remain masked. The OpenRouter key is a separate, spend-limited runtime
credential used by the current scouts and merger. OpenRouter is the default
paid gateway because its broad model/provider catalogue and routing/failover
features fit the reviewer. Workers AI is not a runtime dependency: its
provider-specific integration and higher price for the current anchor model do
not improve this review pipeline.

## QA Commands

These commands validate the wiring without printing secret values:

```bash
doppler secrets --project personal-site --config dev_pages_env --only-names
doppler secrets --project personal-site --config dev_recipe_api --only-names
doppler secrets --project personal-site --config dev_infra --only-names
doppler secrets --project personal-site --config dev_bootstrap_infra --only-names
doppler secrets --project personal-site --config prd_bootstrap_plan --only-names
doppler secrets --project personal-site --config prd_database_backup --only-names
doppler secrets --project ai-review --config prd --only-names
doppler secrets --project homelab --config prd_remote_development_infra --only-names
scripts/sync-doppler-github-envs.sh production-infra-bootstrap-plan
scripts/sync-doppler-github-envs.sh production-remote-development-infra-plan
scripts/sync-doppler-github-envs.sh production-remote-development-infra
scripts/sync-doppler-github-envs.sh production-database-backup
scripts/sync-doppler-github-envs.sh production-ai-review

mise run //:dev
mise run //infra/public-platform:format:check
mise run //infra/public-platform:precommit-lint
mise run //infra/bootstrap:format:check
mise run //infra/bootstrap:precommit-lint
CI=true mise run //workers/recipe-api:typecheck
doppler run --project personal-site --config dev_recipe_api -- mise x -- pnpm --dir workers/recipe-api exec wrangler deploy --dry-run
```
