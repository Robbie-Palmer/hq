# Vector development workstation

`vector-development` turns the MSI Vector GP68HX 13VH into both a normal
graphical workstation and a high-capacity T3 Code development machine. It runs
NixOS 26.05, GNOME, the packaged T3 Code desktop client, Tailscale, and its own
single-node K3s server.

The configuration deliberately does not dual boot. The guarded installation
erases the internal 1 TB WD NVMe, creates a 1 GiB EFI system partition, and
uses the rest as an encrypted LUKS2/ext4 root filesystem. The verified Restic
archive on Backblaze is the recovery source for the previous Ubuntu data.

## Why this shape

Ubuntu with the Nix package manager would work. It would leave host-level GPU,
K3s, user, power, and boot configuration outside the declarative NixOS fleet,
however. Because this installation is disposable and the other compute hosts
already use NixOS, a graphical NixOS system has less configuration drift.

The GTX 1050 desktop proves that the proprietary NVIDIA user space, kernel
driver, container toolkit, and NixOS packaging work in this fleet. The laptop
still needs its own acceptance tests because it is hybrid graphics: the Intel
GPU drives the economical desktop while the RTX 4080 is selected on demand,
and lid, suspend, battery, external display, and PRIME behavior do not exist on
the desktop. `nvidia-offload <command>` selects the RTX 4080 for a host
application. The K3s NVIDIA runtime and device plugin allocate it to the T3
pod.

A Nix remote builder is a machine that accepts Nix derivations over SSH,
builds them, and returns the immutable Nix store results. It accelerates Nix
package or NixOS builds and can build Linux outputs requested from a Mac. It is
not remote OS administration: `nixos-rebuild --target-host` performs remote
deployment. This host initially uses T3 Code and K3s for general development
jobs; remote-builder access is intentionally not enabled because a trusted Nix
builder account is effectively privileged and is unnecessary for that path.

NixOS publishes a stable release every six months and normally supports it
until one month after the next stable release. NixOS 26.05 is supported through
31 December 2026; 26.11 is expected in late November. Upgrade the laptop input
during that overlap. This branch gives the laptop its own 26.05 nixpkgs input,
so it does not silently upgrade the ASUS or Hetzner hosts. Existing machines
also retain their old `system.stateVersion` when their package input eventually
moves forward.

## Runtime layout

- GNOME, Firefox, Chromium, and T3 Code run directly on the host.
- The Intel iGPU is the default renderer; `nvidia-offload` selects the RTX
  4080 for host programs.
- The laptop is an independent K3s server. Losing power or closing it does not
  affect the Mac mini or Hetzner control planes.
- T3 Code runs in namespace `t3-code`, with up to 20 CPU cores and 40 GiB RAM.
  Its rootless Docker sidecar can use another 8 cores and 12 GiB. Kubelet keeps
  2 cores and 4 GiB reserved for the graphical host.
- `/srv/vector-development/t3-code` has a 500 GiB project quota. Rebuildable
  caches have a separate 250 GiB quota. Both live inside the encrypted root
  filesystem.
- Tailscale Serve publishes T3 on HTTPS 443 and browser-QA ports 3000–3004.

## Before installation

Push this branch so it can be checked out on the Mac mini or lighter laptop.
Run the build and manifest checks there before touching the MSI:

```bash
mise run //homelab:nix-flake-check
mise run //homelab:vector-build
mise run //homelab:k3s-render-vector >/dev/null
```

The old desktop installer is not tied to the ASUS hardware: an official NixOS
USB is generic. Reflash it with the current NixOS 26.05 graphical ISO so the
installer, kernel, and firmware match this configuration. The official ISO is
not signed for Secure Boot, so disable Secure Boot in firmware before booting
it. Secure Boot can be enrolled separately after the machine is stable; it is
not part of first commissioning.

Use wired Ethernet if possible. In the live environment, open a terminal and
install one of the public keys already declared in the host configuration:

```bash
sudo -i
install -d -m 700 /root/.ssh
curl --fail --location https://github.com/robbie-palmer.keys \
  | install -m 600 /dev/stdin /root/.ssh/authorized_keys
systemctl start sshd
ip -brief address
```

Confirm the downloaded GitHub keys include a key you hold before starting the
installer. The code never copies a private key onto the laptop.

## Install

From the controlling Mac or laptop, set the live ISO address. The task checks
the NixOS live environment, exact NVMe EUI, model, serial, and size before it
allows the destructive step. It then requires the disk serial to be typed and
prompts twice for a LUKS passphrase without echoing or storing it in the repo.

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

Enter the LUKS passphrase at the laptop after it reboots. Until remote disk
unlock is deliberately added, a person must do this after every full reboot.
The graphical `robbie` account starts locked; set its GNOME and sudo password
over the authenticated SSH connection:

```bash
export VECTOR_DEVELOPMENT_TARGET=root@vector-development.local
mise run //homelab:vector-password
```

Add family accounts in GNOME Settings after login. Make them standard users
with no membership in `docker`, `wheel`, or `video`.

## Tailnet and K3s commissioning

Define `tag:vector-development` in the Tailscale policy and grant the intended
identities SSH, HTTPS, and Kubernetes API access. Then run the interactive
enrollment. It prints a browser URL rather than putting an auth key in shell
history:

```bash
export VECTOR_DEVELOPMENT_TARGET=root@vector-development.local
mise run //homelab:vector-tailscale-enrol
mise run //homelab:vector-kubeconfig
```

Create `homelab/prd_vector_development` in Doppler. It should contain the same
runtime values used by `homelab/prd_remote_development`, including a distinct
random 32-byte `AGENT_AUTH_ENCRYPTION_KEY`. Do not copy interactive OAuth
sessions into Doppler. The preview and Work Graph service-token scopes reuse
`personal-site/dev_agent` and `work-graph/prd_work_graph`.

Install the operator, validate the exact cluster context and home label, deploy,
and run the host/GPU/workload acceptance checks:

```bash
mise run //homelab:doppler-operator-install-vector
mise run //homelab:k3s-dry-run-vector
mise run //homelab:k3s-deploy-vector
mise run //homelab:vector-health
```

The health task verifies GNOME, encrypted storage, zram, the host NVIDIA
driver, the K3s NVIDIA runtime, one advertised GPU, the T3 rollout, `nvidia-smi`
inside the T3 container, and its local HTTP endpoint.

## Connect clients and update the host

The packaged T3 Code desktop application appears in GNOME. It can run local
client sessions and connect to both this laptop and the Hetzner environment.
Create the laptop pairing URL inside the running pod, using the laptop's
MagicDNS name as `--base-url`, in the same way documented for
`remote-development`.

Subsequent host changes are deployed declaratively from another tailnet member:

```bash
mise run //homelab:vector-rebuild
```

Closing the lid suspends on battery. On external power or while docked, closing
the lid is ignored so remote work can continue. A full reboot still waits for
local LUKS unlock, and suspension still stops jobs; use the Hetzner plane for
work that must survive the laptop being unavailable.

This commissioning does not create a new backup policy for future T3 state.
Git branches remain the handoff mechanism, but T3 sessions and authentication
under `/srv/vector-development/t3-code` are not protected by the pre-install
Ubuntu archive. Add and test a dedicated encrypted Restic job before treating
that state as irreplaceable.
