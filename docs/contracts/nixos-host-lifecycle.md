# NixOS host provisioning and lifecycle contract

This contract applies to provider-created virtual machines and operator-owned
physical machines. It turns the working remote-development and Vector patterns
into one host standard. Workloads remain separately declared Kubernetes or
systemd resources.

The checked implementation lives in
`homelab/modules/host-lifecycle.nix`. Both current development hosts import it.

## Ownership boundary

| Concern | Owner | Stored state |
| --- | --- | --- |
| Hardware, VM, network attachment, provider firewall, and durable provider volumes | Terraform or the hardware operator | Provider control plane and Terraform state |
| Partition table, encryption, filesystems, mounts, users, host firewall, Tailscale, container runtime, and K3s | Locked host flake, disko, and NixOS modules | Git and NixOS generations |
| First installation | `nixos-anywhere` using the locked host flake | Operator workstation and target host |
| Workloads and application routing | K3s manifests or NixOS workload modules | Git and the workload control plane |
| Runtime credentials | Host-owned secret bootstrap and workload secret operator | Doppler and root-readable runtime paths |
| Durable data recovery | Application-aware encrypted backup and tested restore | Off-host backup provider |

Terraform may publish non-secret facts needed by the installer. It must not
render Nix modules, write a `flake.nix`, pass secret values through user data, or
own workload manifests. The host flake must not query a provider during
evaluation.

## Host profiles

Every host selects exactly one profile.

### VM profile

The provider creates the VM, temporary bootstrap image, firewall, public SSH
key, and durable volumes. The profile uses stable provider device paths and a
guest hardware module. Root storage is disposable unless the provider handoff
marks it durable.

`remote-development` is the checked VM example. Its root disk uses a stable SCSI
path. The separately protected Hetzner volume survives server replacement and
mounts at `/srv/remote-development`.

### Hardware profile

The operator verifies the machine model, disk model, disk serial, stable disk
path, and size before any destructive command. Firmware, GPU, suspend, and
local-console policy stay in the machine module.

`vector-development` is the checked hardware example. Its install script needs
both an environment guard and a typed confirmation containing the verified disk
serial.

## Provider handoff

A provider root publishes a versioned object with public facts only. The
`infra/remote-development` output is the version 1 reference:

```json
{
  "schema_version": 1,
  "host_name": "remote-development",
  "host_profile": "vm",
  "target": "root@192.0.2.10",
  "root_disk": "/dev/disk/by-path/provider-stable-path",
  "bootstrap_method": "nixos-anywhere",
  "host_key_proof": "provider-console",
  "persistent_mounts": [
    {
      "device": "/dev/disk/by-id/provider-volume-id",
      "mount_point": "/srv/remote-development",
      "preserve_on_replace": true
    }
  ]
}
```

The operator reviews this output with the Terraform plan. A suspended VM emits
no installation target. Provider resource IDs, addresses, device paths, and
mount intent are valid handoff fields. API tokens, SSH private keys, one-time
Tailscale keys, disk encryption keys, passwords, and generated secret files are
not.

No bootstrap credential may appear in a flake input, Nix expression string,
derivation environment, store path, binary cache, Terraform output, or Git
file. The shared module accepts runtime secret paths and rejects paths under
`/nix/store`. An installer obtains each value directly from its authority,
writes it to a mode `0600` temporary tree, passes that tree with
`nixos-anywhere --extra-files` or a declared encryption-key input, and removes
it on exit.

## Declared host state

Each host configuration must declare all of these items:

| Item | Contract |
| --- | --- |
| Identity | One stable RFC 1123 hostname, one `hardware` or `vm` profile, the original NixOS state version, and a non-null flake revision |
| Disk layout | disko owns partitioning and filesystems, using stable `/dev/disk/by-*` paths instead of kernel enumeration |
| Mounts | Every required mount appears in `fileSystems`; durable mounts state replacement and backup policy |
| Users | A numeric operator UID, at least one public key, explicit groups, password policy, and restricted root recovery access |
| Firewall | NixOS firewall enabled, explicit trusted interfaces, Tailscale transport allowed, and provider ingress restricted after commissioning |
| Tailnet | Tailscale enabled; enrollment happens after installation with a one-use tagged key that never enters Nix evaluation |
| Runtime | K3s supplies the standard containerd runtime; another runtime needs an explicit host requirement |
| K3s | Single server role, encrypted Kubernetes secrets, bounded container logs, graceful node shutdown, and unique `key=value` node labels |
| Secrets | Runtime paths and owning services are declared; secret values come from Doppler or another named authority after activation |
| Revisions | `system.configurationRevision` records the Git revision, dirty revision, or flake source-store hash used to build the generation |
| Upgrades | Automatic NixOS upgrades disabled; a reviewed lock update builds every host before a guarded switch |
| Binary caches | `cache.nixos.org` by default; each additional HTTPS substituter includes its public signing key |
| Recovery | Boot generation retention, off-host backups for durable data, repository recovery steps, and an out-of-band console path |

Node labels describe scheduling facts, not workload names. The current label
vocabulary records location, capability, power profile, and an accelerator when
present. Workload selectors may consume those labels without becoming part of
the host flake.

## Installation

1. Review the provider handoff or the physical hardware inventory. Check that
   root and durable disks cannot be confused.
2. Enable the smallest temporary SSH ingress needed for a VM. Boot a trusted
   NixOS installer on physical hardware.
3. Read the target's Ed25519 SSH host-key fingerprint through an independent
   channel. Use the provider console for a VM and the local console for
   hardware. Set the host-specific `*_HOST_KEY_SHA256` variable. The shared SSH
   helper refuses an unverified first key and rejects key changes.
4. Run the guarded `nixos-anywhere` task. It uses the committed lock, disko
   layout, exact host configuration, `--copy-host-keys`, and strict known-hosts
   checking.
5. Reboot. Verify the hostname, configuration revision, disks, encrypted
   mounts, SSH policy, firewall, and Tailscale daemon before enrollment.
6. Enroll Tailscale with a one-use tagged key delivered directly to the host.
   Revoke or expire the key after the node appears with the expected tags.
7. Verify K3s, its node labels, the container runtime, and mount dependencies.
   Bootstrap workload secrets only after the host baseline passes.
8. Disable public bootstrap SSH and clear its CIDRs. Verify management access
   over the tailnet and retain provider-console recovery.

Run the same install command a second time against the disposable target. The
second run must leave the declared partition layout, host identity, mounts, and
service state unchanged. Persistent-volume guards must refuse formatting an
existing encrypted volume.

## Rebuild and rollback

Build before switching:

```bash
mise //homelab:nix-flake-check
mise //homelab:remote-build
mise //homelab:vector-build
```

The operator then runs the host-specific rebuild task over a verified SSH path.
The task switches to the reviewed flake revision and runs the host health check.
Workload rollout starts only after host health passes.

A failed build changes nothing. If activation fails or health regresses, switch
back to the previous system profile and reboot if required:

```bash
sudo nixos-rebuild switch --rollback
sudo /run/current-system/bin/switch-to-configuration boot
sudo reboot
```

The operator records the bad revision, the restored generation, and health
evidence after rollback. Do not garbage-collect the restored generation until
the replacement revision has passed the same checks. Console recovery selects
an older generation from the boot menu when SSH or networking is unavailable.

## Updates and caches

The host flake owns its lock separately from project and workload locks. Update
it through `mise //homelab:nix-update-nixpkgs`, review the lock diff, run the
flake and host builds, then canary the least critical matching profile. Test one
reboot before wider rollout.

Additional binary caches are an optimization. The module requires HTTPS URLs
and public signing keys. Cache credentials, upload keys, and arbitrary user
substituters do not belong on hosts. Keep enough local and cached generations
to cover the rollback window.

## Backup and recovery

Back up durable application and operator data, not reproducible root files or
the Nix store. Each durable mount needs:

- an encrypted off-host destination;
- a scheduled backup with maximum-age monitoring;
- retention policy and capacity alerts;
- a read-data integrity check;
- a dated restore exercise; and
- a list of rebuildable caches excluded from the backup.

Recovery starts from a clean checkout of this repository and the committed
flake lock. Recreate or boot the host, verify its new host key out of band, run
the guarded install, restore durable data, install runtime credentials, enroll
Tailscale, reconcile K3s workloads, and run health checks. A provider snapshot
may shorten recovery but does not replace the off-provider backup.

## Replacement and decommissioning

Replacement preserves only resources named as durable in the provider handoff.
Take and verify a fresh backup, pause alerts, stop workloads, detach protected
volumes, and remove the old compute resource. Verify the replacement host key
before removing the old alias from the dedicated known-hosts file. Install from
the repository, attach or restore data, pass health checks, then close temporary
ingress and resume alerts.

Decommissioning needs an approved data disposition. Take the final backup,
export any required records, revoke Tailscale and provider bootstrap keys,
remove workload and host secrets, destroy compute, and remove DNS and monitoring
state. Delete protected volumes and backups only after the retention decision is
recorded. Keep the Git history and final configuration revision as the build
record.

## Proof

The repository provides these deterministic checks:

| Check | Evidence |
| --- | --- |
| `mise //homelab:host-lifecycle-check` | Both real hosts select the shared module, profile, required mounts, K3s labels, and revision contract |
| `mise //homelab:host-ssh-test` | First-use verification fails closed, a verified key is stored, an alias must match a trusted key, and changed keys fail |
| `mise //infra/remote-development:test` | Active, suspend-ready, and suspended provider states preserve the volume and publish the versioned handoff only for a present server |
| `mise //homelab:host-lifecycle-vm-test` | A disposable NixOS VM boots the shared baseline with the expected hostname, user, SSH, Tailscale, revision, and Nix settings |

One live proof remains before claiming the full provider lifecycle has run end
to end. Create a disposable VM and volume, capture the reviewed handoff, verify
the host key through its console, perform the clean install twice, inject a
configuration whose activation or health check fails, roll back to the prior
generation, delete the VM, recreate it from Terraform, and recover from a clean
repository checkout plus backup. Record plan IDs, configuration revisions,
generation numbers, health output, backup snapshot ID, restore result, and the
final destroy plan. Do not use the production remote-development host for this
exercise.
