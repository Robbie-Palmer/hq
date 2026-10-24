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

## Connect and operate

The T3 Code desktop application appears in GNOME. Create a pairing URL inside
the running pod with `t3 pair`. The command prints the pod address; replace only
that origin with `https://vector-development.tailaa0e46.ts.net` before opening
the URL on another tailnet client. Keep the fragment containing the one-time
token unchanged.

Brave runs directly on the host. GNOME applications send print jobs to the
`canon-mg3100` queue served by CUPS on
`raspberrypi.tailaa0e46.ts.net`.

Deploy later host changes from another tailnet member:

```bash
mise run //homelab:vector-rebuild
```

GNOME automatic suspend is disabled on both battery and external power. Closing
the lid on battery still suspends the laptop. On external power or while docked,
closing the lid leaves the machine running. A full reboot requires the LUKS
passphrase at the laptop.
