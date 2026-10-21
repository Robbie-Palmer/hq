# Cloudflare Access infrastructure

This Terraform root owns provider-wide Cloudflare Zero Trust settings and the
Access resources shared by preview users, CI, and coding agents. HCP Terraform
stores its state in `personal-site-cloudflare-access` and runs plans locally.

## Ownership

This root owns:

- the account's Zero Trust organization settings;
- the account-restricted `Cloudflare` identity provider;
- the reusable `Cloudflare account members` policy;
- the Cloudflare Pages preview application and its two existing inline
  policies;
- the `personal-site-preview-qa-agents` and
  `personal-site-preview-qa-workflow` service identities.

`infra/work-graph` remains the sole owner of the Work Graph application,
policy, and `work-graph-agents` service identity. It has no shared human
identity. No Access resource remains in `infra/public-platform` after the
migration.

Cloudflare provider v5 manages application-scoped policies inside the
application resource. The Pages declaration keeps both existing policy UUIDs,
their order, and their rules. Removing the policy IDs before apply would detach
and delete those policies.

The reusable account-member policy is not attached during this migration.
Attaching it changes who can use an application and needs a separate reviewed
change after recovery tests pass.

## Credentials

Account foundation creates Doppler project `cloudflare-access`, its `ops`
environment, and these configs:

| Config | Use | Cloudflare permissions |
| --- | --- | --- |
| `ops_plan` | Pull-request plans | Organizations, identity providers, and groups read; apps and policies read; service tokens read |
| `ops_drift` | Scheduled drift checks on `main` | The same read permissions as `ops_plan` |
| `ops_apply` | Reviewed default-branch applies | The read permissions above plus write for organizations, identity providers, groups, apps, policies, and service tokens |

Each config also needs an HCP token scoped to
`personal-site-cloudflare-access`. Store values under these names:

- `TF_API_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Mark `CLOUDFLARE_ACCOUNT_ID` unmasked in Doppler so the sync publishes it as a
GitHub environment variable. After the account-foundation apply creates the
environment protections, sync all three configs:

```bash
mise run //infra/cloudflare-access:credentials:sync
```

The plan and drift tokens must not receive write permission. The apply token
does not need Workers, R2, DNS, API-token management, or account settings
permissions. HCP access is limited to this root's operators.

The import API never returns an existing service-token secret. The root omits
`client_secret_version`, so import cannot rotate either token. Existing client
IDs and secrets stay in their current Doppler configs. The post-apply state
check fails if a provider ever writes a service-token secret into this state.

## First migration

Treat the first apply as a maintenance operation even though it should not
interrupt Access.

1. Apply `infra/account-foundation`. Confirm it created the HCP workspace,
   Doppler structure, and three GitHub environments. Populate the scoped
   configs and sync them to their matching environments. A legacy
   public-platform token is not a substitute: it cannot read Access identity
   providers or groups, and the migration plan will fail with HTTP 403.
2. Freeze Access dashboard edits. Confirm the human break-glass login works.
   Pause the preview service-token rotation workflows until both Terraform
   states have settled.
3. Run a plan for this root while `infra/public-platform` still owns its old
   state entries. The plan must import the application, identity provider, and
   two service tokens. It may add only the unattached reusable policy and the
   singleton organization state. Stop if it proposes deleting or replacing an
   application, policy, identity provider, or service token.
4. Review the organization carefully. Cloudflare provider v5 cannot import
   the singleton organization resource. Its create operation updates the one
   organization already attached to the account. The declared name, auth
   domain, WARP setting, and dashboard-write setting match the live values.
5. Apply the saved plan. Run `mise run //infra/cloudflare-access:state:check`,
   then plan again. The second plan must show no changes.
6. Apply `infra/public-platform`. Its `removed` blocks drop only the obsolete
   state entries and use `destroy = false`. Confirm a second public-platform
   plan shows no Access resources.
7. Test a browser login and both preview service identities. Run the protected
   preview HTTP check from the repository guide. Resume credential rotation
   only after those checks pass.

The short period when both states contain the imported objects is deliberate.
It avoids any interval with no state owner, and the old root cannot alter the
objects after its `removed` blocks apply.

The two default-branch workflows can start independently after merge. Do not
allow the public-platform apply to run first. Approve and finish the protected
Cloudflare Access apply, verify its state, and only then rerun or approve the
public-platform deployment that removes the old state entries.

If the new apply fails before it records state, do not apply the old root.
Repair the import and rerun the saved plan. If it fails after recording state,
leave the old root untouched, inspect both states without printing sensitive
values, and recover from the new root. Never delete and recreate either service
identity to repair an import.

## Commands

Run all Terraform operations through mise:

```bash
mise run //infra/cloudflare-access:format
mise run //infra/cloudflare-access:test
mise run //infra/cloudflare-access:credentials:sync
mise run //infra/cloudflare-access:plan
mise run //infra/cloudflare-access:apply
mise run //infra/cloudflare-access:state:check
```

`plan` uses `ops_plan`, `plan:drift` uses `ops_drift`, and `apply` uses
`ops_apply`. The apply task consumes the reviewed `.planfile` and then checks
the raw state for service-token secrets.
