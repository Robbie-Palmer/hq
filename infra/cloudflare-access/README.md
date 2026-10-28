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

The [account-foundation recovery runbook](../account-foundation/recovery.md)
covers Access drift repair, lost credentials, service-token state checks, and
the dashboard read-only gate.

## Credentials

Account foundation creates Doppler project `cloudflare-access`, its `ops`
environment, and these configs:

| Config | Use | Cloudflare permissions |
| --- | --- | --- |
| `ops_plan` | Pull-request plans | Organizations, identity providers, and groups read; apps and policies read; service tokens read |
| `ops_drift` | Scheduled drift checks on `main` | The same read permissions as `ops_plan` |
| `ops_apply` | Reviewed default-branch applies | The read permissions above plus write for organizations, identity providers, groups, apps, policies, and service tokens |

Each config also needs access to the HCP workspace. Store values under these
names:

- `TF_API_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Keep all three values masked in Doppler. The sync publishes them as GitHub
environment secrets after the account-foundation apply creates the environment
protections:

```bash
mise run //infra/cloudflare-access:credentials:sync
```

The plan and drift Cloudflare tokens must not receive write permission. The
apply token does not need Workers, R2, DNS, API-token management, or account
settings permissions.

The reviewed token definitions live in
[`../account-foundation/cloudflare-token-plans/cloudflare-access.yaml`](../account-foundation/cloudflare-token-plans/cloudflare-access.yaml).
The bootstrap creates three account-owned tokens named
`hq-cloudflare-access-plan`, `hq-cloudflare-access-drift`, and
`hq-cloudflare-access-apply`. Cloudflare scopes Access permission groups to an
account, so each policy names only the audited account. The migration inventory
lists the Access organization, application, identity provider, and service
tokens that this root owns.

The HCP organization currently uses the free Personal Developer plan. That
plan exposes only the owners team and does not support workspace team access,
so it cannot issue a workspace-scoped API token. Until the organization moves
to HCP Terraform Essentials or later, these configs reuse the existing
operator user token. The dedicated Doppler configs limit distribution but not
the token's HCP permissions. After an upgrade, replace it with separate team
tokens that grant plan and write access only to
`personal-site-cloudflare-access`.

The import API never returns an existing service-token secret. Cloudflare
provider v5 defaults `client_secret_version` to `1` during import, which is
unsafe for identities that have already rotated. The root therefore owns the
two token records through the same generic REST provider already used by this
repository. Its payload contains only `name` and `duration`; it cannot send a
secret or secret version, so Terraform cannot rotate a credential. Existing
client IDs and secrets stay in their current Doppler configs. The post-apply
state check fails if either token appears through the unsafe Cloudflare
resource or any REST response writes a non-empty service-token secret into
state.

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
   two service tokens. The token imports use their existing IDs and the REST
   provider's collection search. Their one-time normalization may update only
   the already-current `name` and `duration`; it must not create, delete, or
   send a secret version. The plan may add only the unattached reusable policy
   and the singleton organization state. Stop if it proposes deleting or
   replacing an application, policy, identity provider, or service token.
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
