# Ansible migration bridge

This directory implements the host-side bridge from
[ADR 019](../../ui/content/projects/homelab/adrs/019-ansible-k3s-migration-bridge.mdx).
It inventories the three live hosts, gathers facts, configures native Mac
services, prepares an isolated K3s server, deploys the Asus NixOS flake, and
checks fleet health. It does not configure workloads.

Ansible Core is pinned in `homelab/mise.toml`. Run every command through mise
from the repository root:

```bash
mise run //homelab:ansible-inventory
mise run //homelab:ansible-syntax
mise run //homelab:ansible-lint
mise run //homelab:ansible-test
mise run //homelab:ansible-facts
mise run //homelab:ansible-discover-pi
mise run //homelab:asus-deploy
mise run //homelab:ansible-verify
mise run //homelab:ansible-check-mac
mise run //homelab:ansible-configure-mac
mise run //homelab:ansible-verify-ente-fail-closed
```

The facts and verification playbooks only read remote state. They connect to
one host at a time. Ansible runs locally on the Mac mini. The two Linux hosts
use SSH through their MagicDNS names. Test Tailscale SSH before the first
Ansible run:

```bash
tailscale ssh pi@raspberrypi.tailaa0e46.ts.net true
tailscale ssh robbie@asus-desktop.tailaa0e46.ts.net true
```

The inventory keeps normal SSH host-key checking enabled. Accept each Linux
host key with a direct `ssh` connection after the Tailscale SSH test confirms
the node identity. Do not disable host-key checking to skip this step.

The Pi discovery command prints its operating system, SD-card and boot mounts,
relevant package versions, matching systemd units, and CUPS queues. It does not
read service configuration files, which may contain credentials.
The dated findings live in
[`hosts/raspberry-pi/README.md`](../hosts/raspberry-pi/README.md).

Run `asus-deploy` from a clean, pushed Git revision. It deploys that
exact revision through `nixos-rebuild`, checks that NixOS reports the same
configuration revision, and runs `nvidia-smi` inside the existing CUDA 12
container image. A second run skips `nixos-rebuild` when the host already runs
that revision.

`ansible-check-mac` previews the permanent Mac host changes. The apply command
installs the pinned Ente CLI, wrapper, launchd jobs, and Netdata alarms. It
does not start an export. The daily job retains its 03:00 schedule.

The role uses the live system inspected on 2026-09-03. The CLI credentials stay
in `~/.ente/ente-cli.db`, mode `0600`, and never enter Ansible output. The
wrapper verifies the 10 TB volume by UUID before calling `ente export`. It uses
an atomic process lock, caps each run at 30 minutes, and writes non-secret
success and failure timestamps. The health job sends mount, freshness, and
last-run gauges to Netdata once per minute.

The `ente_export` role is temporary. Delete it after the export schedule,
mount guard, runtime watchdog, and monitoring are owned by a K3s CronJob or
another checked-in host configuration and the launchd jobs have been retired.

The verification playbook reads marker metadata only. Normal and verbose
Ansible output does not print the launchd job, mount table, or marker path.

## Isolated K3s profile

The Mac role owns the `homelab-k3s` Colima profile. The existing Compose
services remain on Colima's `default` profile. The role never stops or edits
that default VM.

The pilot profile pins Colima 0.10.3, Lima 2.2.0, and K3s
`v1.36.4+k3s1`. It has 2 CPUs, 4 GiB of memory, and a 60 GiB VM disk. It
mounts `~/.local/share/homelab/k3s/t3-code` at `/srv/t3-code`. The mount is
writable. Add narrower host-volume mounts with the workload that needs them;
the pilot does not expose `/Volumes` to every pod. K3s encrypts Secret data at
rest and registers the node with the `home` location and `agent-workspace`
capability labels.

The profile does not activate its Docker or Kubernetes context globally.
Repository commands address the `colima-homelab-k3s` context explicitly. A
LaunchAgent runs Colima in foreground mode and restarts it if it exits. The
agent starts when the Mac user session starts. A Mac reboot test remains part
of ADR 023 because a LaunchAgent cannot run before login.

Changing the profile config, wrapper, or plist restarts only the isolated
pilot. The role is temporary. Delete it after nix-darwin or another checked-in
host configuration owns this profile, or if the K3s pilot is abandoned.

Colima documents named profiles and its YAML paths in its
[configuration reference](https://github.com/abiosoft/colima/blob/main/skills/references/configuration.md).
K3s documents that server nodes accept
[`--node-label`](https://docs.k3s.io/cli/agent#node-labels-and-taints-for-agents)
at registration.

## ADR 022 acceptance run

Run these commands from a clean checkout on the Mac mini:

```bash
mise run //homelab:ansible-check-mac
mise run //homelab:ansible-configure-mac
mise run //homelab:ansible-configure-mac
mise run //homelab:ansible-verify-ente-fail-closed
mise run //homelab:ansible-verify
```

The second configuration run must report `changed=0`. The fail-closed test
uses disposable directories and dummy configuration to exercise the absent
volume guard and the runtime limit. Its timeout fixture ignores inherited
`SIGALRM`, proving that the parent watchdog terminates the export. The test
neither unmounts the photo disk nor starts a real export.

Before changing ADR 022 to Accepted, run the two verification playbooks in
verbose mode and inspect the output for account identifiers, tokens, and
credentials:

```bash
mise run //homelab:ansible-verify-ente-fail-closed -- -vvv
mise run //homelab:ansible-verify -- -vvv
```

Do not save that verbose output in the repository.
