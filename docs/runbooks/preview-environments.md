# PR preview environment runbook

Use this runbook to bootstrap, recover, rotate, or smoke-test the PR preview
environment. For architecture and safety boundaries, start with
[PR preview environments](../preview-environments.md).

## Setup and recovery

Cloudflare and Neon resources are provisioned by Terraform. Credentials are
configured out of band through Doppler; their sensitive values are not stored
in the repository.

### 1. Bootstrap Pages preview protection

The Pages-specific **Enable access policy** switch is not exposed by the
Cloudflare Terraform provider. The switch creates the preview-aware Access
application, which Terraform manages after a one-time manual import.

The current site is already using that generated application. An unauthenticated
request to a live `pr-<number>.personal-site-bu5.pages.dev` alias redirects to
`personal-site-bu5-pages.cloudflareaccess.com` before Pages Functions run. Do
not create a second wildcard application. If the Access applications API
returns an empty list while the redirect is active, the API token cannot read
Access configuration; grant it **Access: Apps: Read** and query again.

In Cloudflare:

1. Open **Workers & Pages** -> **personal-site** -> **Settings** -> **General**.
2. Enable the preview deployment access policy.
3. In **Zero Trust** -> **Integrations** -> **Identity providers**, add the
   **Cloudflare** identity provider and enable **Restrict to account members**.
   Cloudflare names this provider `Cloudflare`. It uses your existing
   Cloudflare login, including Google sign-in, without adding another OAuth
   client secret. If you replace the provider, copy its UUID from the edit URL
   into the `cloudflare_account_identity_provider_id` variable default.
4. In **Zero Trust** -> **Access** -> **Applications**, open the generated Pages
   preview application. Keep its human allow policy restricted to your exact
   email address. Terraform selects the `Cloudflare` login method,
   skips the identity-provider chooser, and sets the application session to
   Cloudflare's one-month maximum.
5. Record the application ID from its overview or dashboard URL for the import.
6. Record the application audience (`AUD`) tag.
7. Record the team domain, for example
   `https://your-team.cloudflareaccess.com`.
8. Give the account-owned Terraform token **Access: Apps and Policies: Edit**,
   **Access: Organizations: Read**, and **Access: Service Tokens: Edit**. Do not
   add these permissions to a deploy token.
9. Sync `production-infra` after updating `prd_infra`:

   ```bash
   scripts/sync-doppler-github-envs.sh production-infra
   ```

The human allow policy remains outside Terraform. Terraform manages the
application settings and a separate `Service Auth` policy for coding agents and
preview QA.

### 2. Import and apply Terraform

Run the import once, after the resource declaration is ready to merge. Replace
the placeholders with the account and application IDs from Cloudflare:

```bash
cd infra/public-platform
mise x -- bash scripts/doppler-terraform-env terraform import \
  cloudflare_zero_trust_access_application.pages_preview \
  '<account-id>/<application-id>'
```

Merge the resource declaration before any other public-platform deployment.
Terraform will delete an imported resource if the configuration being applied
does not declare it.

Then plan and apply:

```bash
cd ../..
mise run //infra/public-platform:plan
mise run //infra/public-platform:apply
```

#### Roll back Terraform ownership

Do not remove the Access application resource and run a normal apply. Once
Terraform has imported the Pages-generated application, that would delete the
application and its preview login gate.

To return the application to dashboard ownership, remove it from Terraform
state before merging the code that removes its resource declaration:

```bash
cd infra/public-platform
mise x -- bash scripts/doppler-terraform-env terraform state rm \
  cloudflare_zero_trust_access_application.pages_preview
```

Keep the Pages preview access policy enabled in Cloudflare. Merge the matching
code change before another public-platform deployment can recreate the resource.

### 3. Distribute the agent credential

Terraform creates a non-expiring `personal-site-preview-qa-agents` Access
service-token identity and attaches it only to the Pages preview application.
Its secret is rotated separately below. Terraform also adds
`CF_PAGES_HOST` and `RECIPE_API_PREVIEW_ORIGIN_TEMPLATE` to the Pages Function
environment. The canonical `pr-<number>` alias is required for auth; random
hash deployment URLs deliberately refuse to proxy auth to production.

Read the generated credential once after the first apply:

```bash
cd infra/public-platform
mise x -- bash scripts/doppler-terraform-env terraform output -raw preview_access_service_token_client_id
mise x -- bash scripts/doppler-terraform-env terraform output -raw preview_access_service_token_client_secret
```

Store the values as `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in the
dedicated `dev_agent` Doppler config. The remote operator workspace injects this
config through a config-scoped, read-only Doppler token. Local T3 Code agents
load it only for the documented preview command. Do not give that token or the
managed secret to pilot workspaces. Do not put the Access values in repository
files, PR comments, shell profiles committed to a dotfiles repository, or the
preview deployment itself.

The preview Worker verifies the `Cf-Access-Jwt-Assertion` itself. Calling its
public `workers.dev` URL therefore cannot bypass Pages Access for test login.

Terraform also creates `personal-site-preview-qa-workflow`, a separate Access
identity used only by automatic preview Playwright runs. The trusted follow-up
workflow rotates that identity before each serialized run and rotates it again
in an `always()` cleanup step. PR-controlled Pages code can therefore see at
most a credential that is invalidated as soon as its test run finishes; the
long-lived coding-agent credential is never sent to a PR preview.

Automated HTTP clients authenticate with:

```text
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-client-secret>
```

Do not store that service token in this repository.

Agents should use the hostname-allowlisted helper for HTTP QA:

```bash
doppler run --project personal-site --config dev_agent -- \
  mise run //:preview:fetch -- https://pr-123.personal-site-bu5.pages.dev/llms.txt
```

Remote runtimes that already inject `dev_agent` can omit the `doppler run`
prefix. Local agents must not inspect or print the values returned by Doppler.

For browser QA in T3 Code, use the shared browser's existing Cloudflare account
session. If Cloudflare redirects to sign-in, the user must complete that
interactive login before the agent continues. Do not copy the service-token
values into the browser.

The narrowly scoped service-token identity does not expire: extending an expiry
does not rotate its secret and creates an avoidable outage deadline. The
`Rotate Preview Agent Access Token` workflow performs the real credential
rotation every three months. It first places the previous secret behind a
long-lived recovery guard, writes and reads back the new pair in `dev_agent`,
and only then shortens the overlap to seven days so already-running agents drain
cleanly. If the cross-service update is interrupted, the previous credential
continues to work and later runs refuse to rotate over the unfinished guard;
inspect and repair the Cloudflare/Doppler state before clearing it. The workflow
can also be run on demand:

```bash
gh workflow run rotate-preview-access-token.yml
```

The credential rotation and preview Playwright workflows use a dedicated
`preview-agent-access` GitHub environment populated from
`ops_preview_agent_access`. Restrict that environment to the default branch.
Its Cloudflare token needs only **Access: Service Tokens: Read** and **Edit**;
its Doppler service token needs read/write access only to `dev_agent`.

### 4. Create least-privilege Cloudflare tokens

Create a token intended only for previews, with exactly these account-scoped
permissions:

- **Account -> Workers Scripts -> Edit** (deploy/delete preview Workers and
  upload their secrets)
- **Account -> Workers R2 Storage -> Read** (let Wrangler validate the shared
  preview bucket while deploying its binding)
- **Account -> Cloudflare Pages -> Edit** (deploy the canonical PR Pages alias)

Scope it to this Cloudflare account. Cloudflare's Pages permission is
account-level only and cannot be narrowed to the `personal-site` project, so
account scope is the tightest available. Do not reuse a global or DNS-capable
production token.

Create a separate Access-credential automation token for
`ops_preview_agent_access` with only
**Access: Service Tokens: Read** and **Access: Service Tokens: Edit**. It cannot
deploy Workers, edit Pages projects, change policies, or touch DNS.

The preview token does not need R2 write or administration permission:
Terraform owns the shared preview bucket. Wrangler does read the bucket while
validating the Worker binding at deployment time, which is why read access is
required. Workflows are deployed as part of a Worker script, so there is no
separate Workflow token permission.

After Terraform first creates `recipe-artifacts-preview`, configure its object
expiry rule using an administrator's local Wrangler session. Cloudflare provider
v4 can create R2 buckets but cannot manage lifecycle rules:

```bash
cd workers/recipe-ingest
mise x -- pnpm exec wrangler r2 bucket lifecycle add \
  recipe-artifacts-preview expire-preview-artifacts \
  --expire-days 30 --abort-multipart-days 1 --force
```

### 5. Provision the dedicated Neon preview project

Terraform creates a separate `recipes-preview` Neon project; previews must not
reuse the production `recipes` project. Apply the infrastructure configuration
as described in step 2, then publish its outputs to Doppler:

1. Set `NEON_PROJECT_ID` in `stg_recipe_api` from the
   `neon_preview_project_id` output, with unmasked visibility.
2. Set masked `NEON_API_KEY` in `stg_recipe_api` from the sensitive
   `neon_preview_api_key` output.
3. Run `scripts/sync-doppler-github-envs.sh` to update the GitHub environment.

The Terraform resource creates the empty `preview-base` root, a `recipes`
database owned by `recipes_owner`, and the project-scoped API key. Do not add
application tables or a `drizzle.__drizzle_migrations` table to the root.

Every PR database is a normal child branch of `preview-base`. Ordinary child
branches use the project's general branch allowance and inherit only this empty
preview state. Keeping the preview root and credentials in a separate project
also prevents a preview Worker or workflow from connecting to production.

### 6. Create the GitHub environments

Create GitHub environments named `preview-recipe-api`, `preview-site-ui`, and
`preview-agent-access`. Populate them from Doppler by running
`scripts/sync-doppler-github-envs.sh`; do not use the Doppler GitHub sync
integration on the free plan. Restrict `preview-agent-access` to the default
branch.

`preview-recipe-api` receives deployment and database values from
`stg_recipe_api`, plus the shared PostHog runtime values from `stg_pages_env`.

`preview-recipe-api` receives these environment secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Least-privilege preview deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing Pages and Workers |
| `NEON_API_KEY` | Project-scoped key for the dedicated preview Neon project |
| `PREVIEW_AUTH_SEED` | Derives stable, per-PR Better Auth secrets and test passwords |
| `OPENROUTER_API_KEY` | Preview-only key for end-to-end recipe import QA |

Generate `PREVIEW_AUTH_SEED` locally and paste the output directly into GitHub:

```bash
openssl rand -base64 48
```

`preview-recipe-api` receives these environment variables:

| Variable | Example |
| --- | --- |
| `NEON_PROJECT_ID` | Dedicated preview project ID from Neon settings |
| `CLOUDFLARE_PAGES_HOST` | `personal-site-bu5.pages.dev` |
| `CF_ACCESS_TEAM_DOMAIN` | `https://your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Audience tag from the Pages preview Access application |
| `POSTHOG_KEY` | Public, write-only project token used for OTLP export |
| `POSTHOG_HOST` | PostHog application host |

`preview-site-ui` receives values from `stg_site_ui` and `stg_pages_env`.

`preview-site-ui` receives these environment secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Least-privilege preview deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing Pages and Workers |

`preview-site-ui` receives these environment variables:

| Variable | Purpose |
| --- | --- |
| `CF_IMAGES_ACCOUNT_HASH` | Required by the UI build |
| `CLOUDFLARE_PAGES_HOST` | Used when commenting the canonical preview URL |
| `POSTHOG_KEY` | Existing public PostHog project key, if preview analytics remain enabled |
| `POSTHOG_HOST` | Existing PostHog host, if preview analytics remain enabled |

`NEON_API_KEY` is a **project-scoped** key for the dedicated preview project (Neon
Console -> organization -> Settings -> API keys -> Create API key ->
Project-scoped), so it can manage branches in that project and nothing else.
Keep it in the `preview-recipe-api` environment only and rotate it if GitHub
reports any exposure.

`POSTHOG_KEY` and `POSTHOG_HOST` are shared through `stg_pages_env` because the
same public project token correlates browser analytics, Pages requests, API
requests, and ingestion workflow spans. Preview Worker logs also remain
available in Cloudflare Workers Logs.

### 7. Smoke-test a preview

To validate the pipeline (after recreating any of the above, or when debugging),
open or update an internal PR. The workflow runs from `main`. Confirm:

1. The PR receives one `Preview environment` comment.
2. The dedicated Neon preview project contains `preview-pr-<number>` as a child
   of `preview-base`, with no production rows.
3. Cloudflare contains `recipe-api-pr-<number>` with no Hyperdrive binding.
4. The canonical `https://pr-<number>.<pages-host>` URL requires Access.
5. The sign-in menu offers the empty, populated, administrator, and paired
   household (owner and member) scenarios.
6. The onboarding sign-up button creates a new empty QA account on every use.
7. The successful backend and frontend preview jobs automatically trigger the
   `Preview Playwright QA` workflow, which passes its Agent Auth checks.
8. Closing the PR removes both the Neon branch and Worker.

If event-driven cleanup fails, run the **Preview Environment Cleanup** workflow
manually with the PR number. Neon branch expiry is an additional database-only
backstop.
