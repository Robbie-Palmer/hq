# Remote development infrastructure

This independently stateful Terraform root provisions the Hetzner Cloud
resources proposed by
[ADR 021](../../ui/content/projects/homelab/adrs/021-cloud-remote-development-plane.mdx).
It does not configure the operating system or deploy workloads.

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Server, firewall, SSH public key, and persistent volume | This Terraform root |
| Operating system, mounts, Tailscale, and K3s | `homelab/` NixOS flake |
| t3-code and coding-agent workloads | K3s manifests |
| Provider and workload credentials | Doppler |

The remote K3s server is a separate cluster. Never join it to the home K3s
control plane.

## External prerequisites

Prepare these before the first plan:

1. A Hetzner Cloud project and read/write API token.
2. The account-foundation `remote-development` HCP root and `homelab` delivery
   root own the `personal-site-remote-development` HCP workspace, the `homelab`
   Doppler structure, and both GitHub environments. Do not recreate them in
   provider dashboards.
3. Doppler config `homelab/prd_remote_development_infra` containing
   `HCLOUD_TOKEN` and `TF_API_TOKEN` as masked values, plus
   `SSH_PUBLIC_KEY`, `BOOTSTRAP_SSH_CIDRS`, and `BOOTSTRAP_MODE_ENABLED` as
   unmasked values.
4. Populate `production-remote-development-infra-plan` and
   `production-remote-development-infra` from Doppler with
   `scripts/sync-doppler-github-envs.sh`. A dedicated read-only Hetzner token is
   preferred for the plan environment. The plan workflow skips forked pull
   requests before it can access provider credentials.
5. Keep the required reviewer declaration on the apply environment in the
   account-foundation registry.

`BOOTSTRAP_SSH_CIDRS` is a JSON list held as a GitHub environment variable,
for example `["203.0.113.10/32"]`. Leave it as `[]` during normal operation.
Temporarily add the operator's current public address only while installing or
recovering NixOS, and set `BOOTSTRAP_MODE_ENABLED` to `true`. The mode flag
defaults to `false`, so CIDRs alone cannot open public SSH.

Sync either environment after changing its source Doppler config:

```bash
scripts/sync-doppler-github-envs.sh production-remote-development-infra-plan
scripts/sync-doppler-github-envs.sh production-remote-development-infra
```

## Local use

Human-run commands obtain credentials through Doppler:

```bash
export TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"
export TF_VAR_bootstrap_ssh_cidrs='["203.0.113.10/32"]'
export TF_VAR_bootstrap_mode_enabled=true
mise run //infra/remote-development:plan
```

Review `.planfile` before applying it. Application is deliberately separate:

```bash
mise run //infra/remote-development:apply
```

Do not apply a plan that replaces the server or deletes the persistent volume
unless that operation is the reviewed recovery objective. Delete and rebuild
protection default to enabled; disabling them requires a preceding apply.

## First installation

1. Plan and apply with one explicit bootstrap SSH CIDR.
2. Use the `nixos_anywhere_target` output to install the NixOS flake. Do not
   pass Tailscale, Doppler, or GitHub credentials through Terraform. The
   installer records the first host key in
   `~/.ssh/personal-site-remote-development-known_hosts` and preserves that
   key across installation with `nixos-anywhere --copy-host-keys`.
3. Supply a one-time tagged Tailscale key directly to the host bootstrap.
4. Reboot and verify the data mount, Tailscale, and K3s over the tailnet.
5. Set `bootstrap_mode_enabled` to `false` and `bootstrap_ssh_cidrs` back to
   `[]`, then plan and apply the firewall change.

The public IP remains available for outbound connectivity and emergency
provider-console recovery, but the provider firewall exposes no SSH, t3-code,
or Kubernetes management port after commissioning.

All remote-development tasks use that dedicated known-hosts file, persist keys
between runs, and reject a changed key. Override its location with
`REMOTE_DEVELOPMENT_KNOWN_HOSTS_FILE`. After an intentional server reprovision,
remove only the obsolete host entry with `ssh-keygen -R <host> -f <file>` and
confirm the replacement fingerprint through the Hetzner console before the
next connection.

## Persistence

The separately protected volume is formatted once as ext4 and attached without
provider automount. NixOS mounts the stable device exposed by the
`data_volume_linux_device` output. Increasing `data_volume_size_gb` is
supported; shrinking a Hetzner volume is not.

The volume survives ordinary server replacement, but it is not a backup.
Application-level encrypted backups and a tested restore remain required.

Hetzner server backups default to disabled because they cover only the
reproducible root disk, not the attached workspace volume. Enable them only if
faster root-disk rollback is worth the additional cost.

## Suspend and resume

`server_state` controls the compute lifecycle without changing ownership of the
workspace volume:

| State | Server | Server deletion protection | Workspace volume |
| --- | --- | --- | --- |
| `active` | Present | Enabled | Attached and protected |
| `suspend-ready` | Present | Disabled | Attached and protected |
| `suspended` | Absent | Not applicable | Detached and protected |

Suspension needs two reviewed applies because Hetzner will reject deletion of a
protected server. First set `server_state` to `suspend-ready`, merge the change,
and apply it with the protected `Remote Development Infrastructure` workflow.
Confirm that the plan only changes server deletion and rebuild protection.
Then set the state to `suspended`, merge, and apply again. The second plan must
delete only the server and volume attachment. It must retain
`hcloud_volume.workspace`, the firewall, and the bootstrap SSH key.

Before the second apply:

1. Run `mise run //homelab:remote-backup` and require a successful fresh
   encrypted snapshot.
2. Pause the `remote-development-host` Healthchecks.io check.
3. Confirm that no T3 Code work remains active on the remote host.

The suspended configuration keeps the encrypted 100 GiB volume, R2 backups,
HCP Terraform state, Doppler configs, and GitHub delivery environments. Hetzner
stops billing for the deleted server and its automatically managed Primary
IPv4. The retained volume continues to incur storage charges.

To resume, set `server_state` to `active`. Before applying, temporarily enable
bootstrap mode and publish one operator CIDR through
`homelab/prd_remote_development_infra`. An exact CX33 allocation is not
guaranteed, so select another available x86 server type in `nbg1` if needed.
After Terraform creates the server and attaches the existing volume:

1. Read `nixos_anywhere_target` from the reviewed Terraform output and pass it
   as `REMOTE_DEVELOPMENT_TARGET` to the installation task.
2. Verify the replacement host key through the Hetzner console and remove only
   the old entry from the dedicated known-hosts file.
3. Run the installation, Tailscale enrollment, kubeconfig, Doppler operator,
   K3s deployment, backup credential, observability credential, and health
   tasks from the commissioning sections above. The installation guard accepts
   the retained LUKS volume and refuses to format it.
4. Disable bootstrap mode, clear its CIDRs, and apply the firewall change.

The root disk and K3s datastore are rebuilt. T3 Code userdata, repositories,
worktrees, and agent state return from the retained encrypted volume. The R2
snapshot remains the recovery path if that volume is unavailable.
