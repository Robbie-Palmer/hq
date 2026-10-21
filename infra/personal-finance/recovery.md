# Personal Finance infrastructure operations

Use this runbook for credential rotation, drift, destructive plans, state
recovery, and the first workload handoff. Freeze provider-console and
infrastructure changes before recovery work. Start from a clean checkout at a
reviewed revision.

## Rotate a delivery credential

1. Create a replacement with the same or narrower permissions.
2. Write it directly to `TF_API_TOKEN` in the affected `personal-finance`
   config: `ops`, `drift`, or `apply`. Do not pass it in a command argument or
   copy it into a file.
3. Run the matching plan or drift task. For `apply`, run a plan but do not
   apply a change merely to test the token.
4. Sync only the matching GitHub environment and rerun its workflow.
5. Revoke the old credential after the workflow succeeds.

Keep the old and new credentials valid at the same time when the provider
supports overlap. A lost token requires the separately held HCP owner recovery
method. GitHub and Doppler must not be the only places that can recover HCP.

## Investigate drift

Run:

```bash
mise run //infra/personal-finance:plan:drift
```

Exit code 2 means Terraform found drift. During the delivery-only phase, any
resource action is unexpected because this root declares no workload. Inspect
the workspace state and run history without downloading or printing secret
values. Do not apply an empty configuration to erase unknown state.

After runtime resources arrive, classify each difference as an intentional
emergency change, an accidental provider-console change, or a stale state
entry. Preserve intentional changes in configuration before applying. Restore
accidental changes only through a reviewed plan. Import an existing object
before Terraform manages it.

## Review a destructive plan

Stop on every delete, replacement, state move, or provider-driven rotation.
Confirm the resource owner, data-retention effect, recovery path, and exact
import address. Store exports or backups outside this Terraform workspace when
the resource contains user data. Approve the saved plan only after a second
plan from the reviewed revision shows the same actions.

The empty baseline must never produce a destructive plan. Treat one as a state
ownership incident, not as routine cleanup.

## Recover remote state

1. Freeze applies and provider-console edits.
2. Verify a fresh HCP owner login using the separately held recovery method.
3. Inspect workspace run history and state versions. Restore the newest known
   good state version in HCP instead of creating a new workspace.
4. Run `mise run //infra/personal-finance:plan` with plan credentials.
5. Require a no-change plan, then run it again to confirm the result.

Do not migrate to local state during an incident. Do not delete and recreate
`personal-site-personal-finance`; account foundation protects its identity and
records which workspaces may consume its state.

## Hand off to runtime provisioning

The runtime ticket may add workload providers and resources only after:

- account foundation has created the HCP, Doppler, and GitHub containers;
- the three environment root configs contain credentials appropriate to their jobs;
- credential sync has completed after environment protection was verified;
- the pull-request, drift, and apply workflows have each run successfully; and
- two consecutive plans from this empty root report no changes.

Remove or replace the `test:foundation` guard in the same reviewed change that
adds the first workload declaration. Document provider permissions, imports,
backup ownership, and state-sensitive values before that apply.
