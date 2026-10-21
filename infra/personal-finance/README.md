# Personal Finance infrastructure

This Terraform root owns infrastructure for the Personal Finance App. The
current configuration is an empty delivery baseline. It defines remote state,
checks, and release gates but no Worker, Neon, Hyperdrive, R2, Pages, DNS,
routing, or observability resources.

HCP Terraform stores state in `personal-site-personal-finance` and uses local
execution. Account foundation disables automatic apply, global state sharing,
and project-wide state sharing. No other workspace can read this state.

## Delivery boundaries

Account foundation creates Doppler project `personal-finance` and three
environments. Each environment receives a root config automatically, without
the paid config-inheritance feature:

| Config | Use | Minimum access |
| --- | --- | --- |
| `ops` | Pull-request plans | Read and lock this HCP workspace |
| `drift` | Scheduled main-branch drift checks | Read and lock this HCP workspace |
| `apply` | Reviewed main-branch applies | Read and write this HCP workspace |

Each config provides `TF_API_TOKEN`. The wrapper maps it to Terraform's
`TF_TOKEN_app_terraform_io` variable at process runtime. Doppler remains the
source of secret values. Terraform configuration, state, plan comments, and
repository files must not contain the token.

The HCP organization uses the free Personal Developer plan. It does not offer
workspace-scoped team tokens, so the three configs may initially hold an
operator token. The separate Doppler configs and GitHub environments still
prevent pull-request and drift jobs from receiving the production config.
Replace the tokens with workspace-scoped team tokens if the HCP plan changes.

Account foundation also creates these GitHub environments:

| Environment | Branch policy | Review gate |
| --- | --- | --- |
| `production-personal-finance-plan` | Pull-request branches | Required |
| `production-personal-finance-drift` | `main` only | None |
| `production-personal-finance` | `main` only | Required |

After account foundation creates and protects them, populate the Doppler
configs and mirror each config to its matching GitHub environment:

```bash
mise run //infra/personal-finance:credentials:sync
```

The sync command copies values without printing them. Do not sync before the
environment protection rules exist.

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
```

The pull-request workflow runs static checks, the empty-baseline test, and a
remote plan. The scheduled workflow fails when the remote state drifts. The
main-branch workflow creates a fresh plan with production credentials and
applies the saved plan only after the production environment gate opens.

The account-foundation apply must run before this root's first remote plan.
The first and second Personal Finance plans must both report no changes. If
either reports a resource action, stop and inspect the state before continuing.

The [operations runbook](recovery.md) covers credentials, drift, destructive
plans, state recovery, and the handoff to runtime provisioning.
