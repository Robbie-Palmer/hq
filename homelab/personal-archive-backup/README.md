# Personal archive migration

This component implements
[ADR 023](/projects/homelab/adrs/023-restic-backblaze-personal-archive). The
`robbie-vector-gp68hx-13vh` inventory is a one-shot migration before that
laptop is wiped and rebuilt as a homelab build machine. It does not assume the
laptop is always online, install a recurring backup schedule, or create a
freshness alert.

The first `Documents`-only pilot proved the B2 repository, append-only backup
credential, failure reporting, incremental snapshots, and verified restore.
The final migration profile expands the source set to the user data that would
otherwise disappear during the rebuild:

- filed documents, downloads, and local screenshots;
- Thunderbird, Roam Research, Brave, VS Code, T3 Code, and Codex user data;
- SSH, GnuPG, certificate, and desktop-keyring material; and
- small application state that is not reproducible from source control.

The profile excludes downloaded installers, browser and Electron caches, T3
logs, T3 worktrees, and reinstallable Codex packages. It does not include
`~/repos`. Git remains the source of truth for code. Before wiping the laptop,
settle every dirty or unpushed repository separately.

## Credential boundary

The one-shot write key is restricted to the private bucket and the
`restic/robbie-vector-gp68hx-13vh-home-migration/` prefix. Grant it only
`listBuckets`, `listFiles`, `readFiles`, and `writeFiles`. It cannot delete
objects or change bucket retention.

The read-only recovery key covers this laptop's archive prefixes and has only
`listBuckets`, `listFiles`, and `readFiles`. Store that key and the restic
password in the password manager, then copy the password-manager recovery
material to an encrypted external USB drive. Delete the temporary local
transfer bundle after both copies have been checked.

Create maintenance credentials only for an explicit retention or pruning job.
Revoke them when that job ends. Do not store a delete-capable key in the laptop
backup configuration.

The independent
[`infra/personal-archive`](../../infra/personal-archive/README.md) Terraform
root owns the private B2 bucket, its Object Lock capability, and its lifecycle
policy. Application keys stay outside Terraform because their secret values
would enter Terraform state.

## Run the migration

The Doppler config `homelab/prd_personal_archive_backup` contains these masked
values:

| Name | Purpose |
| --- | --- |
| `B2_S3_ENDPOINT` | Bucket region endpoint, without `https://` |
| `B2_BUCKET_NAME` | `robbie-personal-archive` |
| `B2_BACKUP_KEY_ID` | Prefix- and bucket-restricted one-shot write key ID |
| `B2_BACKUP_APPLICATION_KEY` | One-shot write-key secret |
| `RESTIC_PASSWORD` | Client-side repository encryption password |

Install the profile and credentials, then start the migration explicitly:

```bash
mise run //homelab:personal-archive-install -- \
  personal-archive-backup/inventories/robbie-vector-gp68hx-13vh.json
mise run //homelab:personal-archive-credentials
mise run //homelab:personal-archive-backup
mise run //homelab:personal-archive-status
```

The installer disables the user timer for this profile. The backup performs a
full restic data check because this snapshot is a migration boundary rather
than a daily job.

## Recover to the Mac mini external drive

Install restic on the Mac mini. Put the read-only B2 key in a mode `0600`
environment file using the standard S3 names:

```text
AWS_ACCESS_KEY_ID=<B2 recovery key ID>
AWS_SECRET_ACCESS_KEY=<B2 recovery application key>
RESTIC_REPOSITORY=s3:https://s3.eu-central-003.backblazeb2.com/robbie-personal-archive/restic/robbie-vector-gp68hx-13vh-home-migration
```

Put the restic password in a separate mode `0600` file. Create the independent
recovery configuration, then restore to an empty directory on the 10 TB drive:

```bash
recovery_directory="${HOME}/.config/personal-archive-recovery"
install -d -m 0700 "${recovery_directory}"
printf '%s\n' 'ARCHIVE_ID=robbie-vector-gp68hx-13vh' \
  >"${recovery_directory}/home-migration.config"
chmod 0600 "${recovery_directory}/home-migration.config"

PERSONAL_ARCHIVE_CONFIG="${recovery_directory}/home-migration.config" \
PERSONAL_ARCHIVE_RECOVERY_CREDENTIALS="${recovery_directory}/recovery.env" \
PERSONAL_ARCHIVE_RECOVERY_PASSWORD="${recovery_directory}/restic-password" \
  bash personal-archive-backup/scripts/restore.sh \
  "/Volumes/<10TB drive>/Laptop Offload/robbie-vector-gp68hx-13vh"
```

The restore command uses restic's `--verify` option. Compare a fresh manifest
of the restored files with the snapshot before treating the external drive as
the second copy. A new B2 bucket may have little included egress because the
allowance is based on average monthly storage. Check the account's download cap
before a full restore; if it blocks the transfer, wait for the 00:00 GMT daily
reset or set a small explicit paid cap for that restore.

## Wipe gate

Do not wipe the laptop until all of these are true:

- the final migration snapshot and 100 percent repository check pass;
- the recovery key and restic password exist in the password manager and on
  the encrypted recovery USB drive;
- an independent restore succeeds without Doppler or the laptop write key;
- the restored copy on the Mac mini's 10 TB drive passes verification;
- dirty and unpushed Git repositories have been committed, pushed, exported,
  or deliberately discarded; and
- the Backblaze administrative bootstrap key and temporary write or maintenance
  keys have been revoked.

## Evidence log

Do not record credentials or full source paths here.

| Check | Result |
| --- | --- |
| Pilot inventory | 4 PDF files, 376 KiB allocated on 2026-10-21 |
| Pilot snapshots | Live B2 snapshots `f40a77a6` and `93108e66` passed repository checks |
| Pilot restore | Snapshot `93108e66` restored 4 files; restic verification and source checksum comparison passed |
| Pilot alert | Healthchecks.io accepted a forced failure and recovery ping; the check was retired when the profile became one-shot |
| Pilot B2 usage | 302,165 bytes across 9 live objects after two backups |
| Final migration inventory | Downloads, screenshots, mail, browser and editor state, T3 and Codex data, and local credential stores selected; rebuildable caches and source repositories excluded |
| Final migration snapshot | Snapshot `445419d9` captured 18 source roots and passed a 100 percent repository check; restic reports 1,238,044,133 bytes of unique file data |
| Password-manager and USB recovery copies | User verified both copies; the temporary laptop transfer bundle was deleted |
| Independent recovery-key restore | Read-only recovery key restored and verified 22,367 files without Doppler or the write key |
| Recovery egress | The restore materialized 3,700,154,368 bytes and triggered the account's 100 percent daily download-cap alert; exact billable egress was not available from the alert |
| Mac mini 10 TB drive copy | Pending |
| Object Lock maintenance test | Pending |

## Controlled one-day Object Lock experiment

Run this experiment only against a unique prefix under
`object-lock-experiments/`. It never accepts a prefix in the production
`restic/` namespace. The command creates temporary policy and data keys, and
revokes both before it exits. The data key is restricted to the disposable
prefix and deliberately omits `bypassGovernance`.

First, run the idle check on the archive source host and keep its JSON output
in a temporary file. The proof expires after 15 minutes:

```bash
idle_proof=$(mktemp)
mise run //homelab:personal-archive-object-lock-idle-check \
  >"${idle_proof}"
```

Provide the Backblaze administrative key ID and secret through private files,
not command-line arguments or environment values. Then start the experiment:

```bash
B2_ADMIN_KEY_ID_FILE=/private/path/key-id \
B2_ADMIN_APPLICATION_KEY_FILE=/private/path/application-key \
  mise run //homelab:personal-archive-object-lock -- \
    start --idle-proof "${idle_proof}"
```

The command checks the exact private bucket, Object Lock capability, and empty
default-retention setting before creating keys. It installs its teardown trap
before enabling a one-day governance default. After the upload, it verifies
every object under the disposable prefix, removes the default, and proves both
direct deletion and restic prune fail without governance bypass. Its JSON
output is safe to use as the non-secret evidence record. `retainedBytes` and
`retainedByteDays` quantify the experiment's one-day storage behavior. Object
Lock has no separate fee, but those bytes remain subject to normal B2 storage
charges until the reported retention time expires.

After the reported `retainUntil` time, clean up only the recorded prefix:

```bash
B2_ADMIN_KEY_ID_FILE=/private/path/key-id \
B2_ADMIN_APPLICATION_KEY_FILE=/private/path/application-key \
  mise run //homelab:personal-archive-object-lock -- \
    cleanup --prefix object-lock-experiments/YYYYMMDDTHHMMSSZ-NONCE/restic \
    --retain-until YYYY-MM-DDTHH:MM:SSZ
```

The cleanup command refuses to run before expiry or while any bucket default
retention exists. It creates a fresh prefix-only key without governance bypass,
deletes every version in the disposable repository, proves the prefix is
empty, and revokes the key.
