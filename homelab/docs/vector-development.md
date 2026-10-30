# Vector development workstation

This is the installation and commissioning runbook for `vector-development`,
the MSI Vector GP68HX described by
[ADR 025](/projects/homelab/adrs/025-graphical-nixos-development-workstation).
It installs NixOS 26.05, GNOME, Brave, T3 Code, Tailscale, and an independent
single-node K3s development plane.

## Storage layout

The internal drive is a 1 TB WD PC SN560 NVMe SSD. Linux reports 953.9 GiB.
The installer creates a 1 GiB EFI system partition and an encrypted LUKS2/ext4
root filesystem on the remaining space.

T3 Code state lives under `/srv/vector-development/t3-code` with a 500 GiB
project quota. Rebuildable caches live under
`/srv/vector-development/t3-code-cache` with a 250 GiB project quota.

## Preflight

Confirm the Restic archive in Backblaze can still be listed and restored. From
the controlling Mac or laptop, check the configuration and rendered workload:

```bash
mise run //homelab:nix-flake-check
mise run //homelab:vector-build
mise run //homelab:k3s-render-vector >/dev/null
```

Boot a current official NixOS graphical installer with Secure Boot disabled.
Use wired Ethernet when practical. In the live environment, enable SSH with a
public key held by the controlling machine:

```bash
sudo -i
install -d -m 700 /root/.ssh
curl --fail --location https://github.com/robbie-palmer.keys \
  | install -m 600 /dev/stdin /root/.ssh/authorized_keys
systemctl start sshd
ip -brief address
```

Confirm the downloaded key list contains a key available on the controlling
machine.

## Install

Set the live installer's address. The task checks the NixOS live environment
and the NVMe EUI, model, serial, and size. It requires the disk serial to be
typed before erasing the disk and prompts twice for the LUKS passphrase.

```bash
export VECTOR_DEVELOPMENT_TARGET=root@192.0.2.10
export VECTOR_DEVELOPMENT_INSTALL=WIPE
mise run //homelab:vector-install
```

The matched disk must be:

```text
/dev/disk/by-id/nvme-eui.e8238fa6bf530001001b448b4a0a7d9e
WD PC SN560 SDDPNQE-1T00-1032
serial 23304R801651
```

Enter the LUKS passphrase locally after the reboot. Then set the GNOME and sudo
password over the authenticated SSH connection:

```bash
export VECTOR_DEVELOPMENT_TARGET=root@vector-development.local
mise run //homelab:vector-password
```

Create household accounts in GNOME Settings as standard users.

## Commission Tailscale and K3s

Define `tag:vector-development` in the Tailscale policy and grant the intended
identities access to SSH, HTTPS, and the Kubernetes API. Enrol the host and
fetch its kubeconfig:

```bash
export VECTOR_DEVELOPMENT_TARGET=root@vector-development.local
mise run //homelab:vector-tailscale-enrol
mise run //homelab:vector-kubeconfig
```

Create `homelab/prd_vector_development` in Doppler with the runtime values used
by `homelab/prd_remote_development` and a distinct random 32-byte
`AGENT_AUTH_ENCRYPTION_KEY`. The preview and Work Graph service-token scopes
reuse `personal-site/dev_agent` and `work-graph/prd_work_graph`.

Install the Doppler operator, deploy the workload, and run the host and GPU
acceptance checks:

```bash
mise run //homelab:doppler-operator-install-vector
mise run //homelab:k3s-dry-run-vector
mise run //homelab:k3s-deploy-vector
mise run //homelab:vector-health
```

The health check covers GNOME, encrypted storage, zram, the host NVIDIA driver,
the K3s NVIDIA runtime, GPU advertisement and allocation, the T3 rollout, and
the local HTTP endpoint.

## Agent GitHub and Doppler access

The current Doppler plan does not include
[service accounts](https://docs.doppler.com/docs/service-accounts) or custom
roles. Vector therefore uses four write-enabled
[service tokens](https://docs.doppler.com/docs/service-tokens), each bound by
Doppler to one config: `ai-review/dev`, `homelab/dev`, `personal-site/dev`, or
`work-graph/dev`. A checked-in wrapper selects the matching token from an
explicit `--project`, `-p`, or `DOPPLER_PROJECT` value. It rejects every other
project. The workload receives no personal or CLI token and cannot reach
staging, production, operations configs, or Doppler administration APIs.

Account foundation owns the existing `homelab/prd_vector_development` delivery
config, but generated service-token values remain outside Terraform state. The
guarded installer creates and rotates the four service tokens through the
authenticated controller. Separately create a fine-grained GitHub token limited
to `Robbie-Palmer/hq`, with repository contents, pull requests, workflows,
Deployments read/write, and the read permissions needed for checks. Do not
paste it into chat or a shell argument.

Wait until the Vector server has no active T3 work, then run the guarded
interactive installer from the controller:

```bash
mise run //homelab:vector-agent-auth-install
mise run //homelab:vector-agent-auth-health
```

The installer refuses to continue while T3 has active work. It accepts the
GitHub credential without echoing it, creates four config-scoped Doppler
tokens, and uploads all five credentials plus a revision marker to
`homelab/prd_vector_development` in one request. It waits through the configured
Doppler sync interval for the managed Secret and a replacement `t3-code`
Deployment pod to load that revision, then configures Git to use GitHub CLI as
its credential helper. The health task performs a dry-run Git push and a
temporary write-and-delete probe in all four development configs without
printing secret names or values. It also checks the image-installed
`work-graph` command against the production API using credentials injected via
a separate read-only Doppler token. Agent sessions inherit that ready-to-use
command and do not need a personal Doppler login. The installer revokes the
previous four service tokens only after those checks pass.

## Connect and operate

The T3 Code desktop application appears in GNOME. Create a pairing URL inside
the running pod with `t3 pair`. The command prints the pod address; replace only
that origin with `https://vector-development.tailaa0e46.ts.net` before opening
the URL on another tailnet client. Keep the fragment containing the one-time
token unchanged.

Brave runs directly on the host. GNOME applications send print jobs to the
`canon-mg3100` queue served by CUPS on
`raspberrypi.tailaa0e46.ts.net`.

## Severe vulnerability controller

The Vector overlay mounts the versioned controller policy and prompt at
`/etc/agent-coordinator`. T3 Code remains a private NodePort reached through the
tailnet. Do not add a public Kubernetes Ingress, Gateway, LoadBalancer, or a
second Cloudflare Tunnel. T3 Connect supplies the public webhook URL and holds
requests while Vector is offline.

Create one persistent controller thread in the `hq` project and bind one
enabled webhook task to it. Copy the task schedule from
`controller-policy.json`. Configure the GitHub webhook with JSON content and
the same secret as the task's HMAC-SHA256 signature. Subscribe only to
`dependabot_alert`. The task must retain its repository, action, severity, and
alert-number filters, `X-GitHub-Delivery` replay key, and 15-minute delivery age
limit.

Run the admission test before enabling unattended incident work. Send a signed
candidate with a unique delivery ID, then repeat that request with the same ID.
Also send an invalid signature, an out-of-policy repository, and a relay-held
request older than 15 minutes. Inspect T3 Code's delivery records and the bound
thread. The candidate must reach the controller once. The other requests must
not start a controller turn or worker thread. Keep the task disabled if any
case fails.

Deploy later host changes from another tailnet member:

```bash
mise run //homelab:vector-rebuild
```

GNOME automatic suspend is disabled on both battery and external power. Closing
the lid on battery still suspends the laptop. On external power or while docked,
closing the lid leaves the machine running. Host activation refreshes the active
GNOME power daemon so a logged-in session cannot retain the old idle timeout
after a rebuild.

## Remote power and encrypted boot

[ADR 026](/projects/homelab/adrs/026-vault-assisted-vector-remote-boot)
keeps full-disk encryption while making a deliberate remote boot possible.
The wired adapter accepts a magic packet and the initrd exposes SSH on port
2222. That SSH service has a separate host key and accepts only a forced
command that answers the pending LUKS request. It cannot provide a shell,
forward ports, or allocate a terminal.

The laptop must be connected to AC power and wired Ethernet. In UEFI setup,
enable Wake-on-LAN and disable ErP if it prevents the network adapter receiving
standby power. Reserve the laptop's wired MAC address in DHCP so its address
does not change.

Provision the host-control Doppler secrets, initrd host key, and extra LUKS
keyslot once. The task discovers the wired address and MAC from the host,
generates a random 32-byte key directly into Doppler, and checks the exact LUKS
UUID before changing a keyslot. It prompts for the existing LUKS passphrase;
the passphrase is entered directly into `cryptsetup` and is not stored.

```bash
mise run //homelab:vector-remote-boot-provision
mise run //homelab:vector-rebuild
```

The secrets use `homelab/prd_remote_development_host`, the existing
controller-only host config. They do not use `prd_vector_development`, because
that config is injected into the Vector workload. Anyone running the power
tasks needs Doppler access to the host config, the matching SSH private key,
and local network access. Wake and shutdown are explicit:

```bash
mise run //homelab:vector-wake
mise run //homelab:vector-shutdown
```

`vector-wake` pins the initrd host public key from Doppler before sending the
LUKS key over SSH. It then waits for the normal host SSH service and runs the
full Vector health check. `vector-shutdown` checks the remote hostname and
requires `vector-development` to be typed before it powers off the laptop.
GNOME login is not required for K3s, Tailscale, or T3 Code to start.

Keep the original LUKS passphrase. It remains the local recovery path if the
Mac mini, Doppler, DHCP, Ethernet, or initrd SSH is unavailable. To revoke the
remote path, remove its LUKS keyslot before deleting or rotating the Doppler
secret. Test the replacement key with `cryptsetup open --test-passphrase`
before removing the old slot.
