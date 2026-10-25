# Account foundation ownership inventory

Last verified against the provider APIs on 2026-10-21. This inventory is the
input to the account-foundation work described by
[ADR 027](../../ui/content/projects/personal-engineering-platform/adrs/027-account-foundations-as-code.mdx).
It records resource names, non-secret IDs, settings, dependencies, and intended
owners. It does not record secret values.

The term `account-foundation` below means the
`infra/account-foundation` Terraform root. `cloudflare-access` means the
provider-wide `infra/cloudflare-access` root. A workload owner names
the root that owns the resource after migration, even when that root still
needs to be created.

## Ownership rules

Each row in this inventory has one intended state owner.

| Resource kind | Intended owner |
| --- | --- |
| Provider account, billing agreement, owner login, multifactor recovery, and human break-glass access | Manual seed |
| The account-foundation HCP workspace, its initial Doppler config, and the first credentials needed to operate it | Manual seed |
| HCP project and workspace containers, Doppler project and config structure, and GitHub environments and protection rules | `account-foundation` |
| Shared Cloudflare Zero Trust organization settings and Access identities | `cloudflare-access` |
| Application, data, network, and application-specific machine identities | The named workload root |

Secret values remain in Doppler or in a provider's credential store.
`account-foundation` owns the Doppler config structure, while workloads own
the contained values. `account-foundation` also owns each GitHub environment's
name and protection rules. Values mirrored into an environment remain derived
delivery data.

## Manual seed

The seed is limited to the exceptions that cannot safely create or recover
themselves.

| Seed item | Why it remains manual | Recovery record |
| --- | --- | --- |
| Provider owner accounts and billing for HCP Terraform, Doppler, GitHub, Cloudflare, Google Cloud, Neon, PostHog, and Hetzner | An API resource cannot own the legal account or billing agreement that authorizes its provider. | Provider recovery contacts, billing access, and recovery codes stay outside this repository and outside the provider they recover. |
| Human owner login, multifactor authentication, and break-glass access for each provider | Automation must not be the only route to repair its own identity or state. | Exercise a human login before restricting dashboard writes. |
| `Robbie-Palmer/hq`, its default branch, and repository-owner access | The repository must exist before it can declare the platform. | GitHub owner recovery remains independent of Actions and Doppler. |
| Account-foundation HCP workspace in the `robbie-palmer` organization, set to local execution | The root cannot create, rename, delete, or recover its own state container. | Keep the workspace ID and HCP owner recovery with the seed. Do not grant it global remote-state access. |
| Account-foundation Doppler configs and their initial provider credentials | Doppler project structure cannot supply the credential used to create itself. | Store only the account-foundation credentials in the seed configs. Coding-agent and pull-request jobs must not receive them. |
| Initial HCP, Doppler, GitHub, and provider administration credentials used by account-foundation | Revoking the credential during the apply that replaces it could strand the root. | Replace a credential only after a second credential has completed a no-change plan and the break-glass path has been tested. |

Workload API tokens, R2 keys, Access service tokens, database credentials, and
GitHub App keys are not part of the seed. Their owners and rotation risks are
listed below.

## HCP Terraform

All eight workspaces are in the provider-created `Default Project`
(`prj-ZVLoxaAVYbBEHJwH`). They use local execution, disable auto-apply, disable
global remote-state access, have no explicit remote-state consumers, and were
unlocked when checked. `account-foundation` owns the project and workspace
containers. The workload root in the last column remains the sole owner of the
state payload.

| Workspace and import ID | Terraform version | Intended state owner | State payload owner and dependency |
| --- | --- | --- | --- |
| `personal-site` (`ws-qaWEomysU9Ep9wDs`) | `1.13.4` | `account-foundation` | `infra/public-platform`; its workspace must exist before that root initializes. |
| `personal-site-bootstrap` (`ws-DyQ4QhHWWpPsRWgv`) | `1.15.7` | `account-foundation` | `infra/bootstrap`; imports must not alter its privileged Google identity state. |
| `personal-site-remote-development` (`ws-64FJmz4zhCYqNwvg`) | `1.16.1` | `account-foundation` | `infra/remote-development`; preserve the protected Hetzner host and volume state. |
| `personal-site-remote-development-cluster` (`ws-ZbESd7FQxv44fJma`) | `1.16.4` | `account-foundation` | Legacy Kube-Hetzner candidate state. No checked-in root currently references it. Keep its payload frozen until a separate review proves it can be archived or assigns it to a restored workload root. |
| `personal-site-work-graph` (`ws-k55u12qJwQPzzNks`) | `1.16.2` | `account-foundation` | `infra/work-graph`; preserve the production service and credential-safe state boundary. |
| `personal-blog` (`ws-HjanmaPgxFzm1t8F`) | `1.13.3` | `account-foundation` | Legacy state with no checked-in root reference. Keep its payload frozen until a separate review identifies or retires it. |
| `personal-site-cloudflare-access` (`ws-fzzZsPtRtSkedgJY`) | `1.16.4` | `account-foundation` | `infra/cloudflare-access`; the registry created this workspace. |
| `personal-site-personal-archive` (`ws-ZwanvNqFFT5UoVyW`) | `1.16.4` | `account-foundation` | The personal archive root uses this registry-created workspace. |
| `personal-site-personal-finance` (`ws-mnXi1yAp8gUdHw2C`) | `1.16.4` | `account-foundation` | `infra/personal-finance`; the empty foundation does not yet own workload resources. |

Import the `Default Project` first, then every workspace. Declare the observed
settings before import and require a no-change plan. Do not change Terraform
versions as part of the ownership import. The two legacy payloads remain
manual because no current declaration can prove what they contain, but their
workspace containers still have the single administrative owner shown above.

## Doppler

`account-foundation` owns the four imported project containers, their
environments, and the config containers listed here. The workload named in the last
column owns the values and decides which values may be mirrored into GitHub.

| Project | Managed configs | Intended state owner | Value owner |
| --- | --- | --- | --- |
| `ai-review` | `dev`, `dev_personal`, `stg`, `prd` | `account-foundation` | `ai-review` workload |
| `homelab` | `dev`, `dev_personal`, `stg`, `prd`, `prd_personal_archive_backup`, `prd_personal_archive_infra`, `prd_remote_development`, `prd_remote_development_backup`, `prd_remote_development_cluster`, `prd_remote_development_host`, `prd_remote_development_infra`, `prd_remote_development_observability`, the `prd_tailnet_values` environment and its three configs, `prd_vector_development` | `account-foundation` | `homelab`, `infra/remote-development`, `infra/tailnet`, the Vector workstation, and the personal archive workloads |
| `personal-site` | `dev`, `dev_personal`, `dev_agent`, `dev_bootstrap_infra`, `dev_infra`, `dev_ml_pipelines`, `dev_pages_env`, `dev_recipe_api`, `stg`, `stg_pages_env`, `stg_recipe_api`, `stg_site_ui`, `prd`, `prd_bootstrap_infra`, `prd_bootstrap_plan`, `prd_ci_repo`, `prd_database_backup`, `prd_infra`, `prd_pages_env`, `prd_recipe_api`, `prd_recipe_ingest`, `prd_site_ui`, `ops`, `ops_preview_agent_access` | `account-foundation` | The matching public-platform, bootstrap, ML pipeline, recipe, backup, or preview workload |
| `work-graph` | `dev`, `dev_personal`, `stg`, `prd`, `prd_work_graph`, `prd_work_graph_backup`, `prd_work_graph_infra` | `account-foundation` | `infra/work-graph`, Work Graph runtime, and backup workloads |
| `personal-finance` | `ops`, `drift`, `apply` environment root configs | `account-foundation` | `infra/personal-finance` delivery |

Import each project before its environments and configs. Do not read, export,
or set values during the structure import. The provider's root configs such as
`dev`, `stg`, and `prd` are included because they are part of the inherited
config tree.

The three configs named `ops_account_foundation_seed`,
`ops_account_foundation_plan`, and `ops_account_foundation` remain manual seed
exceptions. The import applied 84 Doppler and GitHub resources with no provider
changes on 2026-10-21. The next plan reported no changes.

The Personal Finance registry uses three environments because the current
Doppler plan does not include child-config inheritance. Doppler created the
`ops`, `drift`, and `apply` root configs with their environments. Account
foundation recorded the containers, and a follow-up plan reported no changes.

Account foundation also owns the `vector-development-t3` service account, its
custom secret-value editor role, and its explicit project memberships. The
role contains only the secret read and write permissions and each membership
is restricted to `dev`. The service-account token is a workload credential:
it is created outside Terraform and stored in
`homelab/prd_vector_development`, so its value never enters state.

## GitHub environments

`account-foundation` owns every imported environment container and its deployment
protection policy in `Robbie-Palmer/hq`. Existing secrets and variables are
mirrors populated from Doppler or ephemeral GitHub values. They are not an
independent state source.

| Environment | Observed protection | Value owner |
| --- | --- | --- |
| `copilot` | None | GitHub-managed Copilot workflow boundary |
| `preview-agent-access` | Custom branch policy | Preview credential rotation workload |
| `preview-recipe-api` | None | Recipe preview workload |
| `preview-site-ui` | None | Site preview workload |
| `production-ai-review` | Protected branches | AI review workload |
| `production-ci` | None | Repository CI workload |
| `production-database-backup` | Custom branch policy | Personal-site database backup workload |
| `production-infra` | None | `infra/public-platform` |
| `production-infra-bootstrap` | None | `infra/bootstrap` apply |
| `production-infra-bootstrap-plan` | One required reviewer | `infra/bootstrap` plan |
| `production-personal-finance` | One required reviewer and `main` branch policy | `infra/personal-finance` apply |
| `production-personal-finance-drift` | `main` branch policy | `infra/personal-finance` drift |
| `production-personal-finance-plan` | One required reviewer | `infra/personal-finance` plan |
| `production-recipe-api` | None | Recipe API workload |
| `production-recipe-ingest` | None | Recipe ingest workload |
| `production-remote-development-infra` | One required reviewer | `infra/remote-development` apply |
| `production-remote-development-infra-plan` | None | `infra/remote-development` plan |
| `production-site-ui` | None | Site deployment workload |
| `production-tailnet-infra` | One required reviewer and `main` branch policy | `infra/tailnet` apply |
| `production-tailnet-infra-drift` | `main` branch policy | `infra/tailnet` drift |
| `production-tailnet-infra-plan` | One required reviewer | `infra/tailnet` plan |
| `production-work-graph` | Protected branches | Work Graph runtime |
| `production-work-graph-backup` | Protected branches | Work Graph backup workload |
| `production-work-graph-infra` | Protected branches | `infra/work-graph` |

Import the environments with their current rules before tightening any policy.
Plan and apply credentials must remain separate. A policy-hardening change is
not part of the ownership import and needs its own review because a bad branch
rule can stop production applies or scheduled backups.

The `production-account-foundation-plan` and
`production-account-foundation` environments remain manual seed exceptions.
The three `production-cloudflare-access*` and three
`production-personal-finance*` environments were created by the registry
rather than imported.

## Cloudflare Access

The Zero Trust organization is named `personal-site - Cloudflare Access` with
the authentication domain `personal-site-bu5-pages.cloudflareaccess.com`.
Dashboard write restrictions are currently disabled and must remain disabled
through import, canary, rollback, and break-glass tests.

| Resource and import identity | Intended state owner | Dependency and migration note |
| --- | --- | --- |
| Zero Trust organization settings | `cloudflare-access` | Provider v5 treats this as an account singleton and does not support import. Adopt it through the reviewed singleton update before removing old state ownership. Keep `is_ui_read_only` false until the complete migration passes recovery testing. |
| Account-restricted `Cloudflare` identity provider (`69e998ae-23eb-45a4-b2ed-6f13bb62040b`) | `cloudflare-access` | The Pages application selects this provider. The current infrastructure token can see the reference but cannot enumerate identity-provider metadata. Use the seed owner credential for import without changing the provider. |
| Pages application `personal-site - Cloudflare Pages` (`6a6fe70f-7fac-4416-8a76-914c439e4d4e`) | `cloudflare-access` | Cloudflare Pages originally created it. Move it from `infra/public-platform` only after the provider-wide root declares its wildcard domain and one-month session. Deleting it removes preview login protection. |
| Pages policy `Allow personal account` (`c275b7a3-6095-4b53-a5df-f7121ce84e38`) | `cloudflare-access` | It depends on the shared account identity provider. Import the existing exact-email rule without recording the email in this inventory. |
| Pages policy `Coding agents and preview QA` (`4b19cc49-b3fb-4c56-a0e6-fd88b3740743`) | `cloudflare-access` | It depends on both Pages service identities. Preserve precedence `2` and the `non_identity` decision. |
| Pages service identity `personal-site-preview-qa-agents` (`5083f895-a6cd-430c-85c7-e422baa934de`; the list API currently omits its name) | `cloudflare-access` | The policy membership and checked-in declaration identify it. Moving ownership may require a planned overlap rotation because Cloudflare never returns its secret. |
| Pages service identity `personal-site-preview-qa-workflow` (`c95f960c-8f05-4d9b-a172-ea48efada399`) | `cloudflare-access` | The trusted workflow rotates this credential before and after preview QA. Pause rotation during the state move. |
| Work Graph application `Work Graph API` (`73a46ef0-f53d-4c99-95fc-5f2d8fb176df`) | `infra/work-graph` | It is application-specific and has no shared human identity. Keep it in the workload state. |
| Work Graph policy `Work Graph agents` (`f3fd547d-c58f-4bf8-8d64-3cec24bab109`) | `infra/work-graph` | It depends only on the Work Graph service identity. Preserve precedence `1` and the `non_identity` decision. |
| Work Graph service identity `work-graph-agents` (`dead877e-b27e-49a4-8203-c84824d3a322`) | `infra/work-graph` | Its secret is handed directly to `work-graph/prd_work_graph`; it must not enter Terraform state. |

No live policy references an Access group, and the repository declares none.
The current infrastructure token receives `403` from the group-list endpoint.
Before the provider-wide root's first apply, use the seed owner session to
confirm that the dashboard contains no unreferenced groups. Any group found is
owned by `cloudflare-access` and must be imported before the apply.

## R2 buckets

Bucket names are their import identities. Data and bindings stay in place
during ownership changes.

| Bucket | Current owner | Intended state owner | Dependency and migration note |
| --- | --- | --- | --- |
| `ai-review-data` | `infra/public-platform` | Planned AI review workload root | The production Worker binds it. Remove it from the old state and import it into the workload state in one maintenance window. Never recreate the bucket. |
| `ai-review-data-staging` | Manual dashboard or Wrangler setup | Planned AI review workload root | The staging Worker binds it. Import before changing lifecycle rules. |
| `dvc` | `infra/public-platform` | Planned ML pipelines workload root | DVC clients use bucket-scoped S3 credentials. An ownership-only move should not rotate them. |
| `map-tiles` | `infra/public-platform` | `infra/public-platform` | DNS and cache rules in the same state depend on this bucket. No move is planned. |
| `personal-site-database-backups` | `infra/public-platform` | `infra/public-platform` | Keep deletion protection. Backup and restore jobs depend on bucket-scoped credentials. |
| `recipe-artifacts` | `infra/public-platform` | `infra/public-platform` | Recipe ingestion Workers bind it. Keep the bucket and object keys unchanged. |
| `recipe-artifacts-preview` | `infra/public-platform` | `infra/public-platform` | Preview Workers bind it. Its 30-day lifecycle rule is currently a documented manual provider exception because the pinned provider cannot manage that rule. |
| `remote-development-workspace-backups` | `infra/public-platform` | `infra/remote-development` | The remote host uses bucket-scoped restic credentials. Move state without replacing the bucket or its credentials. |
| `work-graph-database-backups` | `infra/work-graph` | `infra/work-graph` | Keep deletion protection, object locks, and its separate backup credentials. No move is planned. |

The lifecycle rule on `recipe-artifacts-preview` is the only R2 setting that
remains manual. Its owner is still `infra/public-platform`. The pinned provider
cannot manage the rule.

## Privileged provider credentials

This table names credentials and their storage locations only. It does not
record values, fingerprints, or masked exports. A repeated name can refer to
different scoped credentials in different configs.

| Credential class and current locations | Intended owner | Migration or rotation risk |
| --- | --- | --- |
| HCP `TF_API_TOKEN` in `personal-site/dev_personal`, `personal-site/dev_bootstrap_infra`, `personal-site/prd_bootstrap_infra`, `personal-site/prd_bootstrap_plan`, `personal-site/dev_infra`, `personal-site/prd_infra`, `homelab/prd_remote_development_cluster`, `homelab/prd_remote_development_infra`, and `work-graph/prd_work_graph_infra` | The matching workload root; only the first account-foundation owner credential belongs to the manual seed | Replace broad user tokens with root-scoped plan and apply identities after imports. Revoking a shared token early can stop every Terraform root. |
| Cloudflare infrastructure tokens named `CLOUDFLARE_API_TOKEN` in `personal-site/dev_infra`, `personal-site/prd_infra`, `personal-site/ops_preview_agent_access`, and `work-graph/prd_work_graph_infra` | `infra/public-platform`, `cloudflare-access`, preview rotation, or `infra/work-graph`, according to the config | Create the provider-wide token before moving Access resources. A token value change leaves resources intact. Missing permissions can strand imports or rotation. |
| Cloudflare deploy and diagnostics tokens in `ai-review/stg`, `ai-review/prd`, `personal-site/stg_recipe_api`, `personal-site/stg_site_ui`, `personal-site/prd_site_ui`, and `work-graph/prd_work_graph` under `CLOUDFLARE_API_TOKEN`, `OBSERVER_CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_DIAGNOSTICS_API_TOKEN` | The matching workload root | Keep these outside account-foundation. Rotate one workload at a time and verify deployment or diagnostics before revocation. |
| Neon keys named `NEON_API_KEY` in `personal-site/dev_personal`, `personal-site/dev_infra`, `personal-site/prd_infra`, `personal-site/stg_recipe_api`, and `work-graph/prd_work_graph_infra` | The matching public-platform, preview, or Work Graph root | A replacement key can stop Terraform or preview branch creation. Do not combine key rotation with project import. |
| PostHog administration keys named `POSTHOG_API_KEY` in `personal-site/dev_infra` and `personal-site/prd_infra` | `infra/public-platform` | Keep the ingestion-only `POSTHOG_KEY` separate from the administrative key. Rotation can stop dashboard and insight reconciliation. |
| Hetzner key `HCLOUD_TOKEN` in `homelab/prd_remote_development_infra` | `infra/remote-development` | Preserve the server and volume. Test a replacement token with a no-change plan before revoking the current token. |
| R2 S3 key pairs `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `homelab/prd_remote_development_backup`, `personal-site/dev_personal`, `personal-site/dev_ml_pipelines`, `personal-site/prd_ci_repo`, `personal-site/prd_database_backup`, and `work-graph/prd_work_graph_backup` | The named backup or ML workload | Bucket ownership moves do not require rotation. If policy scope changes, overlap old and new keys until a write and restore check passes. |
| Doppler service tokens `DOPPLER_SERVICE_TOKEN` in `personal-site/ops_preview_agent_access` and `WORK_GRAPH_DOPPLER_SERVICE_TOKEN` in `work-graph/prd_work_graph_infra` | Preview rotation and `infra/work-graph`, respectively | These tokens can write only their target configs. Rotate after the account-foundation structure import, not during it. |
| GitHub or mise download tokens `GITHUB_TOKEN` and `MISE_GITHUB_TOKEN` in `personal-site/dev_personal`, `personal-site/dev_infra`, and `personal-site/prd_infra` | Repository CI or `infra/public-platform` delivery | Prefer ephemeral GitHub Actions tokens where possible. A replacement can break tool downloads but does not own provider administration. |
| Google owner login and local Application Default Credentials used for `infra/bootstrap` recovery | Manual seed for the human login; `infra/bootstrap` for the managed service accounts and Workload Identity Federation | Keep owner credentials out of GitHub and coding-agent jobs. Test both plan-only and apply identities before changing trust. |

Generated Access service-token secrets, GitHub App private keys, database URLs,
OAuth client secrets, backup encryption identities, and application runtime
keys remain with their workload. They are intentionally excluded from the
provider-administration credential set above.

## Migration order

1. Freeze dashboard edits for the resource class being migrated. Confirm the
   human break-glass login and provider recovery material first.
2. Create the account-foundation workspace and initial Doppler config as seed
   operations. Add separate protected GitHub plan and apply environments. Do
   not expose their write credentials to pull requests or coding agents.
3. Declare and import the HCP `Default Project`, existing workspace containers,
   the four existing Doppler projects, and the 18 existing GitHub environments.
   This import completed without provider changes on 2026-10-21. The saved
   state produced a no-change plan before any policy edit.
4. Replace shared HCP and provider credentials with scoped plan and apply
   identities one root at a time. Test the new credential before revoking the
   old one. Credential changes are separate from the structure imports.
5. Have account-foundation create the workspace, Doppler structure, and GitHub
   delivery boundaries for `cloudflare-access`. Adopt the organization through
   the provider's account-singleton update. Import the identity provider, Pages
   application with both inline policy UUIDs, and both Pages service identities.
   Add the reusable account-member policy without attaching it. Keep dashboard
   write restrictions disabled.
6. Move the Pages Access resources out of `infra/public-platform` only during
   a coordinated state operation. Cloudflare cannot return service-token
   secrets, so do not perform a blind remove-and-import that causes Terraform
   to replace a token. If replacement is unavoidable, use the existing overlap
   rotation flow and verify Doppler consumers before revocation.
7. Move `ai-review-data`, `ai-review-data-staging`, `dvc`, and
   `remote-development-workspace-backups` to their named workload roots. Remove
   and import state without deleting or recreating a bucket. Verify a workload
   read, write, and recovery path before changing any bucket credential.
8. Run no-change plans for every affected root, exercise an Access canary and
   rollback, and test break-glass recovery from a clean checkout. Only then
   consider setting the Cloudflare Zero Trust dashboard to read-only.

The high-risk steps are HCP token replacement, Access service-identity moves,
and any R2 operation that proposes replacement. Stop before applying if a plan
renames or deletes a state workspace, Access application, service identity, or
bucket.

## Refresh procedure

Refresh this inventory with metadata-only commands. Do not use `doppler secrets
download`, Terraform state output, or provider endpoints that return generated
credentials.

```bash
work-graph show pep-account-foundation-inventory
doppler projects --json
doppler configs --project <project> --json
doppler secrets --project <project> --config <config> --only-names --json
gh api repos/Robbie-Palmer/hq/environments --paginate
```

Use the HCP and Cloudflare list APIs through the narrow Doppler-backed command
wrappers. Filter responses to names, IDs, and settings before displaying them.
The Cloudflare owner session is required to verify Access groups and identity
provider metadata because the current infrastructure token cannot read those
collections.
