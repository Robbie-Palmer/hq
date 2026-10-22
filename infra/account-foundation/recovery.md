# Account-foundation recovery

Use this runbook when setting up the account-foundation root on a clean
machine, replacing an administrative credential, or reconciling an emergency
provider-console change. It covers the account-foundation root and the
Cloudflare Access root that depends on it.

It does not recover a provider owner account. The owner logins, multifactor
recovery methods, and recovery codes are part of the manual seed and stay
outside this repository and outside the providers they recover.

## Before changing anything

1. Freeze administrative changes in HCP Terraform, Doppler, GitHub, and
   Cloudflare for the resources being recovered.
2. Use a clean checkout at a reviewed revision. Check `git status --short`
   before generating a plan.
3. Confirm that the human operator can complete a fresh provider-owner login
   with the separately held recovery method. A cached browser session is not
   enough.
4. Load credentials only through the mise tasks below. Do not download current
   secret values or put replacements in shell arguments, Terraform variable
   files, plan comments, or repository files.

Stop if the owner login cannot be recovered. Do not revoke an overlapping
credential or enable the Cloudflare dashboard read-only setting while that
path is unavailable.

## Restore the account-foundation root

From a clean checkout, verify the manually seeded HCP workspace and initialize
the root with its plan identity:

```bash
mise run //infra/account-foundation:bootstrap
mise run //infra/account-foundation:plan
```

`bootstrap` may create the named workspace when it is absent. When it already
exists, the task only verifies its name, local execution mode, disabled
automatic apply, and disabled global state access. It refuses to repair an
existing workspace whose protected settings differ.

The first plan must report no changes. Stop if it proposes any of these:

- replacing or deleting the account-foundation workspace or a managed
  workload workspace;
- replacing a Doppler project, config, or GitHub environment;
- moving a protected registry entry to a disposable resource address without
  matching `moved` blocks; or
- changing anything unrelated to the recovery.

Investigate provider state and the import registry before applying such a
plan. The root must not repair its own state container by trying to manage it.

## Exercise creation and rollback

The disposable canary checks HCP, Doppler, and GitHub without touching a
workload root:

```bash
mise run //infra/account-foundation:canary:plan
mise run //infra/account-foundation:canary:apply
```

The plan may add only resources named `account-foundation-canary`: one HCP
project and workspace with its settings, one Doppler project and environment,
and one GitHub environment with its `main` branch policy. Do not apply if the
plan changes or deletes an existing object.

Roll the canary back with the ordinary plan:

```bash
mise run //infra/account-foundation:plan
mise run //infra/account-foundation:apply
mise run //infra/account-foundation:plan
```

Review the saved plan before the apply. It may delete only the canary objects.
The last plan must report no changes. If either apply stops partway through,
generate a new plan and inspect the remaining actions. Do not finish the
cleanup in provider consoles because that can leave stale Terraform state.

## Reconcile Cloudflare Access

Start with a read-only plan and a state scan:

```bash
mise run //infra/cloudflare-access:plan
mise run //infra/cloudflare-access:state:check
```

The state check must confirm that neither managed service identity has written
its secret into Terraform state. Stop if it fails.

For emergency dashboard changes, freeze further edits and classify the plan
before applying it:

| Terraform state | Provider object | Response |
| --- | --- | --- |
| Contains the expected object ID | Exists with a deliberate emergency change | Update the declaration to preserve the change, review the resulting plan, and apply it. |
| Contains the expected object ID | Exists with an accidental or temporary change | Apply the reviewed in-place plan to restore the declaration. |
| Missing the object | Still exists | Import the exact provider ID at the declared address. The identity-provider, application, and service-token imports already live in `infra/cloudflare-access/imports.tf`. Add a reviewed import block for another resource rather than using an unrecorded local import. |
| Contains the expected object ID | Missing | Stop. Inspect Cloudflare audit logs and establish why it disappeared. Do not approve a create or replacement as a routine drift repair. |

The Zero Trust organization is an account singleton and the Cloudflare
provider does not support importing it. Its create operation updates the
existing organization. Review every organization field before applying a plan
that adopts or repairs it.

Never recreate the Pages application, identity provider, or service identities
to repair state. Cloudflare cannot return an existing service-token secret, so
recreating a service identity also requires the separate overlap rotation and
consumer-verification flow.

After a repair, run:

```bash
mise run //infra/cloudflare-access:state:check
mise run //infra/cloudflare-access:plan
```

The scan must pass and the plan must report no changes.

## Replace a lost credential

Use the independent owner account for the affected provider. Issue a
replacement with the same or narrower permissions listed in the root README,
then write it directly to the matching Doppler config:

| Lost credential | Recovery location |
| --- | --- |
| Account-foundation HCP state token | HCP owner recovery, then `personal-site/ops/ops_account_foundation_seed`, `ops_account_foundation_plan`, or `ops_account_foundation` as applicable |
| Cloudflare Access HCP state token | HCP owner recovery, then the affected `cloudflare-access/ops/ops_plan`, `ops_drift`, or `ops_apply` config |
| Cloudflare API token | Cloudflare owner account, then `CLOUDFLARE_API_TOKEN` in the affected Cloudflare Access config |
| Doppler provider token | Doppler owner account, then `DOPPLER_TOKEN` in the affected account-foundation config |
| GitHub provider token | Repository-owner account, then `ACCOUNT_FOUNDATION_GITHUB_TOKEN` in the affected account-foundation config |

Run a no-change plan with the replacement. For Cloudflare, run the state check
as well. Sync a repaired config to its protected GitHub environment only after
confirming the environment still has its declared reviewer and branch policy.
Revoke the old credential after those checks pass. When the old credential is
still available, keep both valid until the replacement has completed the
checks.

## Cloudflare dashboard read-only gate

Keep
`cloudflare_zero_trust_organization.shared.is_ui_read_only = false` until one
recovery session has completed all of the following:

- a fresh Cloudflare owner login using the independently held recovery method;
- creation and rollback of the account-foundation canary;
- detection and API repair of a safe Access dashboard change;
- a no-change Cloudflare Access plan with the replacement-capable plan and
  apply identities; and
- a clean service-token state scan.

Enable the setting in a separate reviewed change. After applying it, require a
no-change plan and repeat the protected preview login and service-identity
checks from [`docs/runbooks/preview-environments.md`](../../docs/runbooks/preview-environments.md).
If any gate fails, leave dashboard writes enabled and record the failed check
on the active Work Graph ticket.
