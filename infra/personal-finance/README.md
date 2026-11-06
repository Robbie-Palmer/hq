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

Account foundation creates Doppler project `personal-finance` with four
environments, the Developer-plan limit. The `drift` and `apply` environment
root configs stay empty. Their branch configs separate credentials that must
not reach the same GitHub job:

| Config | Use | Minimum access |
| --- | --- | --- |
| `ops` | Production plans | Read and lock this HCP workspace |
| `drift_preview` | Isolated previews | Preview-scoped Cloudflare and Neon writes |
| `drift_check` | Scheduled main-branch drift checks | Read and lock this HCP workspace |
| `apply_production` | Reviewed main-branch applies | Read and write this HCP workspace |
| `backup` | Database backup and restore | Direct database, R2, and public age-recipient access |
| `apply_alerts` | Alert evaluation and delivery | PostHog alert and project-owned delivery access |

The `ops`, `drift_check`, and `apply_production` configs provide
`TF_API_TOKEN`. The wrapper maps it to Terraform's
`TF_TOKEN_app_terraform_io` variable at process runtime. Doppler remains the
source of secret values. Terraform configuration, state, plan comments, and
repository files must not contain the token. Keep the `drift` and `apply` root
configs empty so their branch configs inherit no credentials.

The HCP organization uses the free Personal Developer plan. It does not offer
workspace-scoped team tokens, so the three configs may initially hold an
operator token. The separate Doppler configs and GitHub environments still
prevent pull-request and drift jobs from receiving the production config.
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
