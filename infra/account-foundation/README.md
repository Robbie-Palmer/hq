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

## Workspace bootstrap

Run the bootstrap task from a trusted human session:

```bash
mise run //infra/account-foundation:bootstrap
```

The task uses the dedicated seed config. It creates the one named HCP workspace
with local execution, automatic apply disabled, and global remote-state access
disabled. If the workspace already exists, the task verifies those settings
and refuses to change them. It has no delete or rename operation.

The Terraform configuration does not declare its own HCP workspace or its
current credential as resources. A future workspace registry may record this
workspace as an external seed, but it must not create a `tfe_workspace`
resource for it. Replacing a seed credential requires an overlapping
credential, a no-change plan, and a tested break-glass login before revocation.

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
```

`plan` uses `ops_account_foundation_plan`. `apply` consumes the saved
`.planfile` with `ops_account_foundation`. The plan file and Terraform working
directory are ignored by Git.

Pull requests run static checks and a plan through
`production-account-foundation-plan`. Merges to `main` run a fresh plan and
apply through the protected `production-account-foundation` environment. The
two workflows never call the seed task or load the seed config.
