# Account foundation infrastructure

This independently stateful Terraform root manages administrative containers
and delivery boundaries shared by the repository's workload roots. The
[ownership inventory](ownership-inventory.md) records what belongs here and
what remains with a workload or the manual seed.

The root uses the `personal-site-account-foundation` HCP Terraform workspace
in local execution mode. HCP stores state, while plans and applies run on the
developer machine or GitHub Actions runner. Global remote-state access stays
disabled.

## Manual seed

The manual seed contains the HCP Terraform owner account and recovery method,
the `personal-site-account-foundation` workspace, the initial Doppler project
and configs, the two GitHub environments below, and the credentials needed to
recover them. Keep provider recovery material outside this repository and
outside the services it recovers.

Create these Doppler configs in the `personal-site` project's `Operations`
environment before the first run:

| Config | Purpose |
| --- | --- |
| `ops_account_foundation_seed` | One-time HCP workspace creation or verification. This config is never used by GitHub Actions. |
| `ops_account_foundation_plan` | Pull-request plans with state access and read-only or narrowly scoped provider credentials. |
| `ops_account_foundation` | Default-branch applies with provider write credentials. |

The provider credentials use these environment variable names:

| Value | Runtime environment variable |
| --- | --- |
| HCP Terraform state and provider token | `TF_API_TOKEN`, mapped to `TF_TOKEN_app_terraform_io` and `TFE_TOKEN` |
| Doppler provider token | `DOPPLER_TOKEN` |
| GitHub provider token | `ACCOUNT_FOUNDATION_GITHUB_TOKEN`, mapped to `GITHUB_TOKEN` |

Do not copy token values into Terraform variables, committed files, command
arguments, plan comments, or logs. HCP local execution requires state read and
write access even for a speculative plan. Scope the plan token to this one
workspace and give its provider credentials read access only. It must not be
able to change provider configuration.

Create `production-account-foundation-plan` and
`production-account-foundation` as GitHub environments before enabling the
workflows. Both environments require reviewer approval. The plan environment
receives only the plan config. The apply environment receives only the write
config and permits only the `main` branch. Owner and seed credentials belong in
neither environment. After verifying those protection rules, mirror the plan
and apply configs without exposing their values:

```bash
mise run //infra/account-foundation:credentials:sync
```

The sync task does not configure protection rules. Do not run it against newly
created environments until their branch and reviewer policy is in place.

## Delivery registry

`delivery.tf` declares the non-secret Doppler and GitHub structure for managed
roots. It owns the existing `ai-review`, `homelab`, `personal-site`, and
`work-graph` containers, plus the structure created for `cloudflare-access`.
Secret values remain with the workload that uses each config.

The three `personal-site/ops` configs named `ops_account_foundation_seed`,
`ops_account_foundation_plan`, and `ops_account_foundation` remain part of the
manual seed. The `production-account-foundation-plan` and
`production-account-foundation` GitHub environments are seed exceptions too.
The root must not make its own recovery path depend on resources it can delete.

The plan environment accepts pull-request branches and requires review. The
drift environment accepts only `main` and has no reviewer gate so scheduled
read-only checks can run. The apply environment accepts only `main` and
requires review. The declaration manages environment names and protection
rules only. GitHub secrets and variables still come from Doppler through the
existing sync flow and are absent from Terraform configuration and state.

Resource keys use the same names as provider import IDs, but some separators
are different. Use the first column as the Terraform import target and the
second as the provider import ID:

| Terraform resource address | Provider import ID |
| --- | --- |
| `doppler_project.managed["<project>"]` | `<project>` |
| `doppler_environment.managed["<project>/<environment>"]` | `<project>.<environment>` |
| `doppler_config.managed["<project>/<environment>/<config>"]` | `<project>.<environment>.<config>` |
| `github_repository_environment.managed["<repository>/<environment>"]` | `<repository>:<environment>` |
| `github_repository_environment_deployment_policy.managed["<repository>/<environment>/<branch-pattern>"]` | `<repository>:<environment>:<policy-id>` |

Import the project before its environments and configs. Import a GitHub
environment before its custom branch policies, then require a no-change plan.
Do not run the ordinary apply if Terraform proposes replacing an imported
container. Every managed project, environment, and config has
`prevent_destroy`; GitHub environments have the same guard.

## Workspace bootstrap

Run the bootstrap task from a trusted human session:

```bash
mise run //infra/account-foundation:bootstrap
```

The task uses the dedicated seed config. It creates the one named HCP workspace
with local execution, automatic apply disabled, and global remote-state access
disabled. If the workspace already exists, the task verifies those settings
and refuses to change them. It has no delete or rename operation.

The Terraform configuration reads its own HCP workspace as a data source. It
never declares that workspace or its current credential as resources, so an
ordinary plan cannot rename or destroy its state container. Replacing a seed
credential requires an overlapping credential, a no-change plan, and a tested
break-glass login before revocation.

## HCP root registry

`variables.tf` declares the typed `hcp_projects` and `hcp_roots` registries.
Each root entry names one workspace, its project, exact Terraform version,
run-queue and file-trigger settings, tags, explicit state consumers, deletion
policy, and optional import ID. The provider creates the workspace and applies
these fixed settings:

* local execution;
* automatic apply disabled;
* organization-wide and project-wide state access disabled;
* only the workspace IDs named by `state_consumers` allowed to read state.

Existing projects and workspaces include their provider IDs. Import blocks
claim those objects at their protected resource addresses. The HCP, Doppler,
and GitHub imports completed on 2026-10-21. The import apply recorded 84
Doppler and GitHub objects without changing a provider resource, and the next
plan reported no changes.

Protected entries use Terraform `prevent_destroy`. A temporary canary must set
one `additional_roots` entry with `deletion_protected = false` for both HCP and
delivery. The checked-in `canary.tfvars.example` declares the complete canary.
Review and apply it with:

```bash
mise run //infra/account-foundation:canary:plan
mise run //infra/account-foundation:canary:apply
```

Doppler creates the environment root config automatically. The canary does not
create a child config because the current workplace plan does not include
config inheritance. After verification, run the ordinary plan without the
canary variable file. It must destroy only the disposable canary resources.
Apply that reviewed plan, then require another no-change plan.

Changing `deletion_protected` moves an existing entry between resource
addresses. Add explicit per-key `moved` blocks in the same change so Terraform
moves state instead of deleting and recreating the provider objects. For
example, promoting the `canary` project and workspace requires both moves:

```hcl
moved {
  from = tfe_project.disposable["canary"]
  to   = tfe_project.protected["canary"]
}

moved {
  from = tfe_workspace.disposable["canary"]
  to   = tfe_workspace.protected["canary"]
}
```

Reverse the two moves when removing protection. Review a plan that reports
only address moves before applying the policy change.

The current registry manages these workspaces in the provider-created
`Default Project`. Existing workspaces have import IDs. The Cloudflare Access
and personal archive workspaces were created from the registry:

| Registry key | Workspace |
| --- | --- |
| `public-platform` | `personal-site` |
| `bootstrap` | `personal-site-bootstrap` |
| `cloudflare-access` | `personal-site-cloudflare-access` |
| `personal-archive` | `personal-site-personal-archive` |
| `remote-development` | `personal-site-remote-development` |
| `remote-development-cluster` | `personal-site-remote-development-cluster` |
| `work-graph` | `personal-site-work-graph` |
| `personal-blog` | `personal-blog` |

## Commands

Run every operation through mise:

```bash
mise run //infra/account-foundation:init
mise run //infra/account-foundation:format
mise run //infra/account-foundation:validate
mise run //infra/account-foundation:lint
mise run //infra/account-foundation:test
mise run //infra/account-foundation:credentials:sync
mise run //infra/account-foundation:plan
mise run //infra/account-foundation:apply
mise run //infra/account-foundation:canary:plan
mise run //infra/account-foundation:canary:apply
```

`plan` uses `ops_account_foundation_plan`. `apply` consumes the saved
`.planfile` with `ops_account_foundation`. The plan file and Terraform working
directory are ignored by Git. `test` runs the shell boundary tests and a mocked
Terraform plan; the test does not use live provider credentials.

Pull requests run static checks and a plan through
`production-account-foundation-plan`. Merges to `main` run a fresh plan and
apply through the protected `production-account-foundation` environment. The
two workflows never call the seed task or load the seed config.
