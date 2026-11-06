# Personal Finance infrastructure

This Terraform root owns the generated stateful infrastructure for the
Personal Finance App: the API Worker and Hyperdrive binding, Cloudflare Access,
an R2 backup bucket, production and preview Neon projects, and PostHog
telemetry and alerts. Project-owned operation hooks live beside the generated
rollout manifest and are kept separate from the Copier-owned resource graph.

HCP Terraform stores state in `personal-site-personal-finance` and uses local
execution. Account foundation disables automatic apply, global state sharing,
and project-wide state sharing. No other workspace can read this state.

## Delivery boundaries

Account foundation creates two Doppler projects so every credential scope uses
an environment root config. The Developer plan permits four environments per
project and this workplace does not support config inheritance. The
`personal-finance` project owns plan, drift, apply, and backup credentials.
The `personal-finance-operations` project owns preview and alert credentials.

| Config | Use | Minimum access |
| --- | --- | --- |
| `personal-finance/ops` | Production plans | Read and lock this HCP workspace |
| `personal-finance-operations/preview` | Isolated previews | Preview-scoped Cloudflare and Neon writes |
| `personal-finance/drift` | Scheduled main-branch drift checks | Read and lock this HCP workspace |
| `personal-finance/apply` | Reviewed main-branch applies | Read and write this HCP workspace |
| `personal-finance/backup` | Database backup and restore | Direct database, R2, and public age-recipient access |
| `personal-finance-operations/alerts` | Alert evaluation and delivery | PostHog alert and project-owned delivery access |

The `ops`, `drift`, and `apply` configs provide `TF_API_TOKEN`. The wrapper
maps it to Terraform's `TF_TOKEN_app_terraform_io` variable at process runtime.
Doppler remains the source of secret values. Terraform configuration, state,
plan comments, and repository files must not contain the token.

The HCP organization uses the free Personal Developer plan. It does not offer
workspace-scoped team tokens, so the three configs may initially hold an
operator token. Separate Doppler root configs and GitHub environments prevent
pull-request and drift jobs from receiving the production config.
Replace the tokens with workspace-scoped team tokens if the HCP plan changes.

Account foundation also creates these GitHub environments:

| Environment | Branch policy | Review gate |
| --- | --- | --- |
| `production-personal-finance-plan` | Pull-request branches | Required |
| `preview-personal-finance` | Internal pull requests | None |
| `production-personal-finance-drift` | `main` only | None |
| `production-personal-finance` | `main` only | Required |
| `production-personal-finance-backup` | `main` only | None |
| `production-personal-finance-alerting` | `main` only | None |

After account foundation creates and protects them, populate the Doppler
configs and mirror each config to its matching GitHub environment:

```bash
mise run //infra/personal-finance:credentials:sync
```

The sync command creates one read-only, config-scoped Doppler service token per
config and installs only that token in its matching GitHub environment. It does
not copy provider values into GitHub. Do not run it before the environment
protection rules exist.

The committed handoff contract at
`operations/bootstrap-contract.json` lists required names, never values. Check
the contract before populating any config:

```bash
mise run //infra/personal-finance:bootstrap:check
```

After injecting one scoped config, run its presence check through that config's
service token. The check reads environment-variable presence and prints only
missing names:

```bash
OPERATIONS_SECRET_CONFIG_REF=doppler://personal-finance-operations/preview \
  doppler run --project personal-finance-operations --config preview -- \
  mise run //infra/personal-finance:bootstrap:check:runtime
```

The backup config deliberately excludes the private age identity and scratch
restore target. Supply `AGE_IDENTITY_FILE`, `RESTORE_DATABASE_URL`, and
`RESTORE_OBJECT_KEY` only for an attended restore drill from the separate
recovery-key custody path. The scheduled workflow creates backups only; it
cannot run a restore because GitHub and Doppler do not hold the private key.

## Commands

Run operations through mise:

```bash
mise run //infra/personal-finance:format
mise run //infra/personal-finance:validate
mise run //infra/personal-finance:lint:tflint
mise run //infra/personal-finance:security:scan
mise run //infra/personal-finance:test
mise run //infra/personal-finance:plan
mise run //infra/personal-finance:plan:drift
mise run //infra/personal-finance:apply
mise run //infra/personal-finance:bootstrap:check
```

The pull-request workflow always runs static checks and the generated-resource
test. Remote plan, apply, and drift steps additionally require the repository
variable `PERSONAL_FINANCE_TERRAFORM_READY=true`. Keep it unset while Account
Foundation creates the protected environments and the scoped Doppler configs.
After the non-secret inputs and provider credentials are handed off, set the
variable and require a reviewed remote plan before merge.

The account-foundation apply must run before this root's first remote plan.
Review that first plan against the generated ownership manifest before applying
it. The next plan must report no changes; if it contains any resource action,
stop and inspect the state before continuing.

The [operations runbook](recovery.md) covers credentials, drift, destructive
plans, state recovery, and the handoff to runtime provisioning.
