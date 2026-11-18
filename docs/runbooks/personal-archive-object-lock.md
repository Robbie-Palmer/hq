# Personal archive Object Lock

This runbook records the proven Backblaze B2 Object Lock behavior and the
guardrails for a later production rollout. It does not enable a production
retention policy. [ADR 023](../../ui/content/projects/homelab/adrs/023-restic-backblaze-personal-archive.mdx)
keeps that decision open until the owner approves a retention period and its
storage cost.

## Current state

The private personal archive bucket has Object Lock enabled but no default
retention. Existing repository objects are therefore not immutable merely
because the bucket supports Object Lock. Backblaze applies a new bucket
default only to objects uploaded or copied after the setting changes. Existing
objects need an explicit per-version retention update.

The one-day governance experiment passed in a separate disposable bucket:

- 21 uploaded versions retained 10,144 bytes for one day;
- a prefix-scoped key without `bypassGovernance` could not delete a retained
  version;
- `restic forget --prune` returned success by adding hide or delete markers,
  while every locked upload version remained stored and billable;
- the bucket default was removed immediately after the controlled upload
  window;
- cleanup deleted all three disposable repositories and the dedicated bucket
  after expiry; and
- every temporary policy, data, maintenance, and cleanup key was revoked.

The experiment did not list, change, restore, prune, or delete a production
personal archive prefix.

## Recommended production design

Use governance mode first. Do not use compliance mode for the initial personal
archive policy. Governance mode supplies the ransomware and accidental-delete
barrier as long as routine credentials lack `bypassGovernance`, while still
leaving an explicit account-owner recovery path for a serious configuration
mistake.

Use 30 days for the first cost estimate. The owner must approve the final
setting. A policy in that range gives time to detect a compromised client or
mistaken prune while retained-version growth is measured. Record the approved
duration and cost estimate in ADR 023 before enabling it.

Once approved, keep the bucket default stable. Do not toggle retention around
each backup. Per-backup changes create an unprotected timing gap and force the
backup path to depend on a retention-changing credential.

Keep these credential boundaries:

| Identity | Stored in | Allowed work | Forbidden work |
| --- | --- | --- | --- |
| Backup key | Doppler backup config | List, read, and write one repository prefix | Delete files, change retention, legal hold, governance bypass |
| Recovery key | Password manager and encrypted recovery media | List and read the recovery prefixes | Write, delete, change retention, governance bypass |
| Infrastructure key | Infrastructure secret boundary | Read and manage the declared bucket policy | Read or delete archive contents, governance bypass |
| Maintenance key | Private, short-lived operator session | Inspect versions and delete expired versions in one named prefix | Governance bypass, legal hold, unrelated prefixes |
| Account owner credential | Password manager only | Create or revoke narrow application keys | Routine backup, restore, or pruning |

Pair the retention policy with a prefix-scoped lifecycle rule for hidden
versions. The lifecycle delay must be longer than the approved retention
period, with at least one extra day for Backblaze's periodic lifecycle pass.
Object Lock blocks an early lifecycle deletion, but locked hidden versions
still consume storage until deletion succeeds.

## Production rollout gates

1. Finish the verified Mac mini copy on the 10 TB drive. Object Lock does not
   replace the local recovery copy required by ADR 023.
2. Approve the retention period, expected retained-version growth, and monthly
   storage budget. Start the estimate with 30 days.
3. Add the default governance retention and matching lifecycle rule to the
   `infra/personal-archive` plan. The plan must target the exact existing
   bucket and fail if an unexpected default already exists.
4. Prove the archive source and restic job are idle before applying the policy.
   Prepare a finally path that removes a newly added default if verification
   fails. Removing the default affects future uploads only. It does not unlock
   versions that already have a retain-until time.
5. Upload a new canary through the normal backup credential. Verify its mode
   and retain-until timestamp with a separate read-capable identity.
6. Run a read-only restore while the canary is locked. Recovery must not depend
   on delete, retention-change, or governance-bypass authority.
7. Protect existing repository versions in a separate, prefix-bounded job.
   Bucket default retention is not retroactive. Inventory exact file IDs,
   apply the approved governance retain-until time, verify every updated
   version, then revoke the temporary retention writer.
8. Exercise prune and post-expiry cleanup again against a disposable prefix
   using the production duration. Check versions and retained bytes directly.
9. Enable alerts for backup failure, stale successful backup, retained-byte
   growth, and lifecycle cleanup failure.

Do not combine steps 3 and 7 in one change. A default-retention mistake can be
rolled back for future uploads. A per-version retain-until timestamp cannot be
treated as equally reversible.

## Prune and cleanup checks

Treat a zero exit code from restic as repository-level evidence only. It does
not prove that Backblaze deleted immutable versions.

For each maintenance window:

1. record the exact repository prefix and the latest retain-until timestamp;
2. run restic's consistency checks before pruning;
3. run `forget` and `prune` with a prefix-scoped key that has no
   `bypassGovernance` capability;
4. list upload versions for that exact prefix and record retained bytes;
5. allow the lifecycle rule to delete hidden versions after retention expires;
6. prove the expired versions are absent; and
7. revoke the maintenance key.

Never grant delete, retention-change, or governance-bypass authority to the
normal backup or recovery credentials.

## References

- [Backblaze Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock)
- [Backblaze lifecycle rules](https://www.backblaze.com/docs/cloud-storage-lifecycle-rules)
- [Backblaze Native API retention updates](https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-native-api)
- [ADR 023](../../ui/content/projects/homelab/adrs/023-restic-backblaze-personal-archive.mdx)
- [Personal archive operator notes](../../homelab/personal-archive-backup/README.md)
