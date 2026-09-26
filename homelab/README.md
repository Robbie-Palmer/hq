# Home Lab (code-as-config)

This directory declares the home lab's machines as code, following the layout
planned in [ADR 010](/projects/homelab/adrs/010-nixos-gpu-worker). The goal is
the same one that motivates the whole lab, the same config in produces the
same system out, every change is reviewable and rollbackable, and nothing is
hand-edited on a box that then forgets it.

All services are reachable only over the home LAN and the
[Tailscale](/projects/homelab/adrs/000-tailscale) tailnet. The router
forwards no ports, so nothing is ever public.

[ADR 025](/projects/homelab/adrs/025-cloud-remote-development-plane) proposes
an off-site t3-code environment for continuity during a home power or broadband
outage. It is an independent, single-node K3s cluster on a NixOS VPS, not a
remote member of the home cluster. The two environments share declarations and
handoff through GitHub branches rather than sharing live application state.

## Remote development plane

The NixOS host lives under `hosts/remote-development/`. Disko owns the VPS root
disk, including the K3s datastore and image store. The attached Hetzner volume
is encrypted with LUKS2, mounted at `/srv/remote-development`, and holds t3-code
state, coding-agent authentication, repositories, worktrees, and rebuildable
tool caches. Terraform owns only the Hetzner server, firewall, public SSH key,
and volume.

The cloud K3s server is independent from the home cluster. The Kustomize base
under `k3s/base/t3-code/` contains shared workload policy. The `home` and
`remote-development` overlays provide separate local volumes, scheduling,
resource limits, Doppler configs, and tailnet ports. Deployment tasks verify
the exact Kubernetes context and every node's location label before applying.

The remote workspace definitions live under
`k3s/overlays/remote-development/workspaces/`. The default overlay applies only
the `operator` workspace. It keeps namespace `t3-code`, durable volume path
`/srv/remote-development/t3-code`, rebuildable cache path
`/srv/remote-development/t3-code-cache`, and tailnet HTTPS port 443. This
single VPS is not a multi-user host.

### First commissioning

Create two Doppler configs before installation:

- `homelab/prd_remote_development_host` stores the restricted
  `DATA_VOLUME_LUKS_KEY` and the one-use `TAILSCALE_AUTH_KEY`.
- `homelab/prd_remote_development` supplies runtime values to the Doppler
  Kubernetes Operator. Do not put interactive OAuth sessions in this config.

The operator workspace also reads `personal-site/dev_agent` through a separate
read-only Doppler token. Keep only `CF_ACCESS_CLIENT_ID`,
`CF_ACCESS_CLIENT_SECRET`, and `CLOUDFLARE_PAGES_HOST` there. The installation
task stores that token as `t3-code/doppler-agent-token`.

Work Graph access uses another read-only token, scoped to
`work-graph/prd_work_graph`. The operator selects only the API URL, allowed
origin, and Access client pair from that config. It renames the Access pair to
the Work Graph-specific environment variables before injecting them into the
operator workspace. The workload never receives the Doppler service token or
the database and infrastructure credentials held in the same config. The
pilot namespace does not receive Work Graph access.

Build the host, encrypt the empty volume, and install NixOS while Terraform's
single bootstrap SSH CIDR is active:

```bash
mise run //homelab:nix-flake-check
mise run //homelab:remote-build
mise run //homelab:remote-volume-prepare
mise run //homelab:remote-install
```

Before enrolling the server, define `tag:remote-development` in the tailnet
policy and grant only the intended operator identities access to SSH, HTTPS,
and the Kubernetes API on that tag. Generate an auth key with these settings:

- One-off enabled.
- Tag set to `tag:remote-development`.
- Pre-approved enabled if device approval is in use.
- Ephemeral disabled, because this server must retain its tailnet identity.

Store the key without putting it in shell history. This command accepts the
value interactively and finishes when a line containing only `.` is entered:

```bash
doppler secrets set TAILSCALE_AUTH_KEY \
  --project homelab \
  --config prd_remote_development_host \
  --visibility restricted
```

Start Tailscale on the operator workstation, then complete enrollment and
cluster setup:

```bash
mise run //homelab:remote-tailscale-enrol
mise run //homelab:remote-kubeconfig
mise run //homelab:doppler-operator-install-remote
mise run //homelab:k3s-dry-run-remote
mise run //homelab:k3s-deploy-remote
mise run //homelab:remote-health
```

Kubeconfig refreshes preserve the first trusted K3s certificate authority. If
an intentional cluster rebuild changes it, verify the rebuild over the
authenticated host connection and set
`REMOTE_DEVELOPMENT_ACCEPT_NEW_KUBE_CA=1` for one refresh.

The workload image normally arrives from GHCR. For a first install before the
registry package exists, build, test, and load it over SSH before deployment:

```bash
mise run //homelab:t3-image-build
mise run //homelab:t3-image-check
mise run //homelab:t3-image-load-remote
```

After tailnet SSH, HTTPS, and the health task pass, set Terraform's
`bootstrap_mode_enabled` to `false` and `bootstrap_ssh_cidrs` to `[]`, review a
new plan, and apply it. Reboot once more and rerun `remote-health`. Never remove
public SSH first.

### Agent authentication

Interactive CLI sessions stay on the encrypted volume. Codex uses file-based
credential storage inside the container because a system keyring is not
available. Keep each subscription in its own `CODEX_HOME` and use device-code
login from a shell in the t3-code pod:

```bash
CODEX_HOME=/data/home/.codex codex login --device-auth
CODEX_HOME=/data/home/.codex-personal codex login --device-auth
```

T3 labels the second provider `codex2`. Its shadow home keeps
`auth.json` separate while sharing the main Codex configuration, skills, and
session state. The image bootstrap keeps its existing colour, enabled state,
and extra configuration when it adds this provider. The bootstrap also sets
GPT-5.6-Sol with high reasoning as the new-thread default for every Codex
provider. It builds the custom model catalog from Codex's cached catalog, so
the other available models remain selectable. To refresh that snapshot, remove
`models_cache.json` and `model-catalog.json`, restart once to fetch the current
catalog, then restart again to apply the preferred defaults to it.

#### Adding a Codex provider

`scripts/codex-add-provider` registers an additional Codex subscription and
starts its login. It detects the environment: inside a t3-code pod it targets
`/data/home`, symlinks shared state into a new shadow home such as
`/data/home/.codex-<name>`, and uses device-code login; on a workstation it uses
`~/.codex-t3/<name>`, edits `~/.t3/userdata/settings.json`, and opens the
browser login. Run it from the repo checkout, in a pod shell for a remote
environment and on the workstation for the desktop client:

```bash
mise run //homelab:codex-add-provider codex-4 --slug alt
```

The instance id in the t3-code settings must differ from every existing Codex
instance in that settings file. The instance id and slug are independent, so
the same subscription can use a different id on each environment, for example
`codex4` in a pod and `codex-4` on the desktop. Omit `--slug` to name the
shadow home after the instance id. `--accent` overrides the colour (default
next unused palette entry), `--device-auth`/`--browser-auth` force a login
mode, and `--no-login` registers without signing in. The remote image's
bootstrap preserves extra instances it did not create, so a registered pod
instance survives pod restarts.

The script never reads the primary `auth.json`; the new account's credentials
are written only into its own shadow home. Verify the instance appears in the
client under the right label, then restart the pod or desktop client once.

The resulting `auth.json` files contain access tokens. Do not copy them into an
image, Doppler, Kubernetes manifests, Terraform, logs, tickets, or chat. GitHub
access should use a fine-grained repository token or GitHub App held in the
remote workload Doppler config. Other interactive coding-harness sessions
belong under `/data/home`, not in an image layer.

### Tailnet QA ports

The operator workspace reserves ports 3000 through 3004 for browser QA. Run
the application on an unused port and bind it to `0.0.0.0`, then open the same
HTTPS port on the remote-development MagicDNS name. For example, an app on
port 3000 is available at:

```text
https://remote-development.<tailnet-name>.ts.net:3000/
```

Tailscale terminates HTTPS on the host and proxies the request through the
matching Kubernetes NodePort to the operator pod. Stop the application when
QA finishes so another agent can reuse the slot. These ports do not provide
the pod with outbound access to other tailnet devices.

### Memory pressure

The host uses a zstd-compressed zram swap device capped at 25 percent of RAM,
about 2 GiB on the current server. Kubelet tolerates host swap but keeps
`NoSwap` behavior for pods. This gives K3s, Tailscale, SSH, and other host
processes room to survive a short spike without letting a T3 workload exceed
its Kubernetes memory limit or hide sustained pressure in slow paging.

Zram is a last buffer. Investigate any non-trivial swap use and memory pressure
rather than raising pod limits. Disk capacities stay unchanged, so a full
`/tmp`, cache, root filesystem, or persistent volume still needs storage
housekeeping.

### Project quotas

The NixOS definition mounts the data filesystem with project quotas. A systemd
oneshot assigns project IDs to existing files, makes new descendants inherit
them, and applies these hard limits before K3s starts:

| Path                                    | Contents                        | Limit  | Inodes    |
| --------------------------------------- | ------------------------------- | ------ | --------- |
| `/srv/remote-development/t3-code`       | Durable operator workspace data | 55 GiB | 3,000,000 |
| `/srv/remote-development/t3-code-cache` | Rebuildable operator caches     | 30 GiB | 2,000,000 |

The 98 GiB formatted filesystem retains about 13 GiB outside those quota
ceilings. The cache cannot consume durable workspace capacity, and deleting it
must never remove T3 state, worktrees, branches, credentials, or sessions.
The durable PV and bound claim retain their original 90 GiB capacity for
upgrade compatibility because Kubernetes cannot shrink a claim. The ext4
project quota is the authoritative 55 GiB hard limit.

Fresh volumes created by `remote-volume-prepare` have the required ext4
features from the start. The existing volume was upgraded on 2026-09-14. The
procedure below records that completed migration for recovery context; do not
repeat it on the current volume. Enabling these features on another legacy
volume changes filesystem metadata and needs a short outage.

#### Historical project-quota migration

Do not run this operation until `/srv/remote-development` has a verified,
encrypted backup outside this Hetzner volume. The e2fsprogs undo file below is
useful for an operator mistake, but it cannot recover from a power loss and is
not a backup.

Build the new generation before the maintenance window:

```bash
mise run //homelab:remote-build
```

Open a root shell over Tailscale. Confirm the source, filesystem type, inode
size, and current feature list. Stop if the source is not the expected mapper,
the type is not ext4, or the inode size is below 256 bytes.

```bash
ssh root@remote-development
cd /root
findmnt --noheadings --output SOURCE,FSTYPE,OPTIONS /srv/remote-development
tune2fs -l /dev/mapper/remote-development-data \
  | grep -E '^(Filesystem features|Inode size):'
```

Stop K3s, check for remaining users of the mount, and unmount it. If `umount`
reports that the filesystem is busy, investigate the processes shown by
`fuser`. Do not use a forced unmount.

```bash
systemctl stop t3-code-tailscale-serve.service k3s.service
fuser --mount --verbose /srv/remote-development || true
umount /srv/remote-development
```

Run a filesystem check, enable project tracking and the internal project quota
inode, then check the filesystem again. Exit status 1 from `e2fsck` means it
fixed errors; any higher status needs investigation before mounting the
volume.

```bash
check_ext4() {
  e2fsck -f /dev/mapper/remote-development-data
  check_status=$?
  if [ "${check_status}" -gt 1 ]; then
    echo "e2fsck failed with status ${check_status}; stopping maintenance" >&2
    return "${check_status}"
  fi
  return 0
}

check_ext4 || exit $?
tune2fs \
  -z /root/remote-development-before-project-quota.e2undo \
  -O project \
  -Q prjquota \
  /dev/mapper/remote-development-data
check_ext4 || exit $?
```

Mount the volume with the option expected by the new definition, verify it,
then leave the remote shell:

```bash
mount \
  -o noatime,prjquota \
  /dev/mapper/remote-development-data \
  /srv/remote-development
findmnt --noheadings --output SOURCE,FSTYPE,OPTIONS /srv/remote-development
exit
```

Switch without the automatic health check because K3s was deliberately
stopped. Start the quota unit and workloads, then run the full check:

```bash
REMOTE_DEVELOPMENT_SKIP_HEALTH=1 mise run //homelab:remote-rebuild
ssh root@remote-development \
  'systemctl start remote-development-project-quotas.service k3s.service t3-code-tailscale-serve.service'
mise run //homelab:remote-health
ssh root@remote-development \
  'repquota --project --verbose --no-names --output=csv /srv/remote-development'
```

The report must contain projects 2000 and 2002 with the limits listed
above. Keep the undo file until the host has rebooted and the health check has
passed again. If the NixOS switch fails, leave the volume mounted with
`prjquota`, start the old `k3s.service` and
`t3-code-tailscale-serve.service`, and investigate before retrying.

The manifest test renders every Kustomize overlay, validates every object with
Flux Schema, and checks the final workspace objects by kind, name, namespace,
and field value. Missing schemas fail the test. The server-side dry run remains
the final check against the CRD and admission behavior installed on the live
cluster.

### Updates, rollback, and backups

Build every NixOS change first, then switch it over the tailnet:

```bash
mise run //homelab:remote-build
mise run //homelab:remote-rebuild
```

Automatic NixOS upgrades are disabled so an unattended update cannot strand
the remote host. Review NixOS security advisories and flake update PRs at least
weekly, expedite critical fixes, and use the build-then-rebuild sequence above
for every update.

Reverting the configuration and rebuilding is the normal rollback. NixOS boot
generations provide console recovery. Workload rollback restores the previous
image reference from Git and reapplies the cloud overlay.

Hetzner server backups are disabled because they cover the reproducible root
disk and exclude the attached volume. They would speed up root recovery, but
they would not protect the data that matters here. LUKS encryption and Hetzner
volume replication are also not backups. An encrypted, versioned copy of the
workspace directories under `/srv/remote-development/` in a separate provider
or failure domain is still required. Do not claim backup coverage until that
destination and a tested restore procedure exist.

## Fleet inventory and checks

[ADR 022](/projects/homelab/adrs/022-ansible-k3s-migration-bridge) introduces
Ansible as a temporary host-discovery and migration tool. mise installs the
pinned Ansible Core release and remains the command interface:

```bash
mise run //homelab:ansible-inventory
mise run //homelab:ansible-syntax
mise run //homelab:ansible-lint
mise run //homelab:ansible-facts
mise run //homelab:ansible-discover-pi
mise run //homelab:asus-deploy
mise run //homelab:ansible-verify
mise run //homelab:ansible-check-mac
mise run //homelab:ansible-configure-mac
mise run //homelab:ansible-verify-ente-fail-closed
```

The facts and verification commands connect to each live host in turn without
changing remote state. The Mac configuration command owns the native Ente job
and a separate `homelab-k3s` Colima profile. See
[`ansible/README.md`](ansible/README.md) for first-connection setup and the
reviewed apply command, profile boundaries, and ADR 022 acceptance run.

[ADR 024](/projects/homelab/adrs/024-doppler-secrets) assigns homelab secrets
to the separate Doppler `homelab` project. Check access without printing values
with `mise run //homelab:doppler-check`. Native session databases such as the
Ente CLI database stay local. Do not upload them to Doppler.

## asus-desktop, the NixOS GPU worker

The Asus desktop (ADR 010) runs NixOS, declared in [`flake.nix`](flake.nix)
and [`hosts/asus-desktop/`](hosts/asus-desktop/). Nothing on the box is
hand-edited; every change goes through this repo. It is reachable over the
tailnet as `asus-desktop`.

### Deploying a change

1. Edit the config under `hosts/asus-desktop/` and commit.
2. Push the commit (the deploy target resolves it from GitHub).
3. From the Mac mini: `mise run //homelab:asus-deploy`

Ansible deploys the exact checked-out commit, verifies that NixOS reports the
same revision, and runs the CUDA 12 container check. Rollback options: revert
the commit and re-deploy, pick the previous generation in the boot menu, or
run `sudo nixos-rebuild --rollback` over SSH.

### Using the GPU

CUDA runs in Docker containers only, from the CUDA 12 image family (CUDA 13
dropped Pascal):

```bash
docker run --rm --device nvidia.com/gpu=all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

The GTX 1050 has 2GB of VRAM, so batch sizes and model sizes are capped.

### Caveats

- The uplink is an Honor Magic5 Pro over USB tethering. Keep the phone
  charged with tethering enabled, or the box drops off the tailnet.
- Wake-on-LAN waits on powerline ethernet adapters, so the box must stay
  awake. Suspending it strands it: the tether link dies with it.

## Jellyfin on the Mac mini

Jellyfin (ADR 011) runs on the hub. A launchd agent keeps it running across
reboots and crashes.

### Jellyfin one-time bootstrap

Run on the hub with mise installed and Homebrew available:

```bash
mise run //homelab:bootstrap
```

The bootstrap will prompt you to create a `.env` file from the example
template and set `MEDIA_DIR` to your media library, then re-run.

Once complete it prints access URLs:

- **Local**: `http://localhost:8096`
- **LAN** (Fire TV Stick): `http://<hub-lan-ip>:8096`
- **Tailnet** (phone / laptop): `http://<hub-tailscale-ip>:8096`

Then add your media folders in the Jellyfin web UI: TV shows under
`/media/TV` and movies under `/media/Movies`.

### Jellyfin day-to-day

```bash
mise run //homelab:status
mise run //homelab:logs
mise run //homelab:restart
mise run //homelab:verify
```

### Jellyfin upgrading

1. Bump `JELLYFIN_VERSION` in `.env` (or pin an exact release).
2. `mise run //homelab:pull`

### Jellyfin caveats

- **Brief unauthenticated window on first bootstrap.** Between the stack
  starting and provisioning completing, Jellyfin's startup wizard is
  accessible on the port. The router forwards no ports and the tailnet is
  the lab's trust boundary, so this is only a risk if an untrusted peer is
  on the LAN during the few seconds bootstrap runs.
- **The drive must be mounted before bootstrap.** If the volume isn't
  connected or auto-mounted at login, the mount point won't exist.
- The [Netdata](/projects/homelab/adrs/009-netdata) alerting on the hub now
  covers the Jellyfin container (see the media automation section below);
  the media drive itself is the remaining gap, so a dead disk is only
  noticed when playback fails.

## Media automation on the Mac mini

The *arr stack (ADRs 016–019) feeds the Jellyfin library automatically:
[Prowlarr](/projects/homelab/adrs/017-prowlarr-indexer-management) manages
the torrent indexers and syncs them to Sonarr (TV) and Radarr (movies), which
send grabs to the containerized
[qBittorrent](/projects/homelab/adrs/018-single-containerized-torrent-client)
and import finished downloads into `/media/TV` and `/media/Movies` with
Jellyfin-friendly names.
[Recyclarr](/projects/homelab/adrs/019-recyclarr-trash-guides) keeps both
apps' quality profiles on the TRaSH Guides with a nightly sync. A launchd
agent (`homelab.media`) keeps all of it running across reboots, same as
Jellyfin's.

Web UIs (LAN/tailnet only): Prowlarr **9696**, Sonarr **8989**, Radarr
**7878**, qBittorrent **8080**. Login is `admin`; qBittorrent's password is
generated into the gitignored `.env`.

### Media automation one-time bootstrap

Run on the hub with mise installed and colima already set up by the Jellyfin
bootstrap. The media volume must be mounted first:

```bash
mise run //homelab:media-bootstrap
```

This creates `.env` from the example template, generates the qBittorrent
password, installs the launchd agent, starts the four containers, and runs
idempotent provisioning that wires download clients, root folders, indexers,
and the indexer sync between them.

### Media automation day-to-day

```bash
mise run //homelab:media-status
mise run //homelab:media-logs
mise run //homelab:media-restart
mise run //homelab:media-verify
mise run //homelab:media-provision   # re-run wiring; safe to repeat
```

### Media automation upgrading

1. Bump the `*_VERSION` pins in `.env` (or leave as `latest`).
2. `mise run //homelab:media-pull`

### Media automation caveats

- **Adding a series or film** happens in Sonarr/Radarr's UI (or their APIs);
  everything downstream is automatic. Or skip the UIs entirely: anything
  added to the [Trakt](https://trakt.tv) watchlist lands in the library on
  its own. See the recommendation-loop caveat below.
- **Recommendation loop (Trakt)**: watchlist taps flow into Sonarr/Radarr
  via their native "Trakt User" import lists, and the Jellyfin Trakt plugin
  scrobbles plays back so recommendations improve ([ADR 021](/projects/homelab/adrs/021-trakt-watchlist)).
  Each integration needs a one-time OAuth: in Radarr/Sonarr *Settings →
  Lists*, add "Trakt User", hit "Authenticate with Trakt"; in Jellyfin,
  Plugins → Trakt. Two traps: the list's username must match your profile
  slug exactly. Copy it from your Trakt profile URL and preserve its dashes.
  The `_` variant returns an empty watchlist instead of
  an error; and lists re-fetch at most every 12 hours, with failures
  counting as a sync, so delete + recreate the list to force an immediate
  retry while debugging.
- **qBittorrent bans IPs after five failed logins** for an hour. Scripts
  should try each credential once; if you lock yourself out,
  `docker restart qbittorrent` clears the ban list.
- **First provisioning has no preset password**: qBittorrent's temporary
  first-boot password comes from its logs, so wiping
  `data/qbittorrent/` and re-running bootstrap is the reset path.
- **New shared host directories require colima to know `/Volumes` is
  writable.** If a bind mount shows up read-only inside containers, check
  `writable: true` for `/Volumes` in `~/.colima/default/colima.yaml`, then
  `colima stop && colima start`.
- **New series and films need the right profile.** Recyclarr creates the
  TRaSH quality profiles; pick them (WEB 1080p for TV, HD Bluray + WEB for
  movies) when adding media. Items added before the profiles existed keep
  their old profile until switched manually.
- **Recyclarr sync runs nightly** (`@daily` in-container cron). Manual run:
  `docker exec recyclarr recyclarr sync`. Logs live in
  `data/recyclarr/logs/`.
- **The stack waits for the VPN.** Both provisioning and the keep-running
  agent refuse to start the containers until the hub's default route runs
  through a VPN tunnel interface, so torrent traffic never touches the
  residential line during the boot race ([ADR 020](/projects/homelab/adrs/020-vpn-gated-stack)).
- **Health gauges and alerts.** The keep-running agent probes every service
  endpoint each cycle (plus the VPN tunnel itself) and pushes 0/1 gauges into
  Netdata's local StatsD listener; it also restarts any container Docker marks
  unhealthy for three consecutive cycles, since a hung process never exits and
  Docker's own restart policy never fires for one.
  [`netdata/health.d/media_automation.conf`](hosts/mac-mini/netdata/health.d/media_automation.conf)
  turns those gauges into Slack alerts through the existing Netdata
  notification pipeline. Install it with:
  `cp hosts/mac-mini/netdata/health.d/media_automation.conf /opt/homebrew/etc/netdata/health.d/`
  and restart netdata.

## SilverBullet on the Mac mini

SilverBullet (ADR 014) runs on the hub as the human-facing notes application.
It shares a private Git-backed Markdown space at `~/knowledge` with Basic
Memory. A launchd agent keeps it running across reboots and crashes.

SilverBullet uses host port **3001** because AdGuard Home occupies port 3000
on the Mac mini. AdGuard's macOS network extension intercepts browser HTTPS
traffic before Docker's port mapping can reach it.

### SilverBullet one-time bootstrap

Run on the hub with mise installed, Homebrew available, and colima running
(set up by the Jellyfin bootstrap):

```bash
mise run //homelab:sb-bootstrap
```

The bootstrap will:

1. Create a `.env` from the example template if one does not exist.
2. Initialise a private Git repository at `~/knowledge` if one does not exist.
3. Install and start a launchd agent.
4. Bring up the Docker Compose stack.

Edit `SB_USER` in the `.env` file before the second run:

```bash
printf 'SB_USER=%s:%s\n' "$(whoami)" "$(openssl rand -base64 18)" >> hosts/mac-mini/silverbullet/.env
```

### SilverBullet Tailscale Serve

After bootstrap, Tailscale Serve is managed automatically by a launchd agent
(`homelab.tailscale-serve`). It verifies every 5 minutes that port 3001 is
served and re-applies if overwritten by another Tailscale serve/funnel
invocation (e.g. t3-code preview agents).

```bash
# Check current status
tailscale serve status

# Manually re-apply if needed
tailscale serve --bg 3001
```

This provides HTTPS access at `https://<machine-name>.ts.net/` from any
device on the tailnet. Do not use Funnel or expose the port to the LAN.

### SilverBullet day-to-day

```bash
mise run //homelab:sb-status
mise run //homelab:sb-logs
mise run //homelab:sb-restart
mise run //homelab:sb-verify
```

### SilverBullet upgrading

1. Bump `SB_VERSION` in `.env` (or leave as `:latest`).
2. `mise run //homelab:sb-pull`

### SilverBullet caveats

- **Port 3000 is unavailable.** AdGuard Home natively occupies port 3000
  with a macOS network extension that intercepts browser traffic. Use
  port 3001 (or any other free port) for SilverBullet.
- **Shell backend is disabled.** The ADR disables `SB_SHELL_BACKEND` because
  t3-code agents already provide the automation layer. If you need shell
  commands from within SilverBullet, change `SB_SHELL_BACKEND` in the
  compose file, but review the security implications first.
- **Authentication is enabled** as defence in depth. The `SB_USER`
  credentials are required for browser and API access.
- **SilverBullet listens on localhost only.** The Docker compose file binds
  `127.0.0.1`. Remote access goes through Tailscale Serve, not direct
  port exposure.
- **SilverBullet health is watched too.** The media-automation keep-running
  agent reports the SilverBullet container's Docker health as a Netdata gauge,
  and the shared
  [`media_automation.conf`](hosts/mac-mini/netdata/health.d/media_automation.conf)
  alarm file raises a Slack alert if it stays unhealthy or exits.

## Basic Memory on the Mac mini

Basic Memory (ADR 014) is the agent-facing knowledge engine. It runs as a
host-level Python CLI, no Docker, no launchd agent. The MCP server is
launched on demand by each t3-code agent.

### Basic Memory one-time bootstrap

```bash
mise run //homelab:bm-bootstrap
```

This installs `uv`, the `basic-memory` CLI, and registers `~/knowledge`
as the default project.

### Basic Memory day-to-day

```bash
mise run //homelab:bm-status      # sync status between files and index
mise run //homelab:bm-reset       # rebuild index from Markdown files
```

### Connecting agents

After bootstrap, connect each t3-code agent to the MCP server:

**Claude Code:**

```bash
claude mcp add basic-memory -- bm mcp --project knowledge
```

**Codex** (add to `~/.codex/config.toml`):

```toml
[mcp_servers.basic-memory]
command = "bm"
args = ["mcp", "--project", "knowledge"]
```

**opencode** (add to `~/.config/opencode/config.json`):

```json
{
  "mcp": {
    "basic-memory": {
      "command": "bm",
      "args": ["mcp", "--project", "knowledge"]
    }
  }
}
```

### Basic Memory caveats

- **No persistent daemon.** The MCP server launches on demand; there is
  nothing to monitor or restart.
- **SQLite index is disposable.** Run `bm reset` to rebuild from files.
  The database lives at `~/.basic-memory/` outside the Git repository.
- **Shared space with SilverBullet.** Both tools index the same
  `~/knowledge` Markdown files. Changes through either interface are
  visible to the other after the file watcher syncs.
- **Manual reindex needed for CLI use.** The file watcher only runs when
  the MCP server is active. For `bm tool search-notes` from the terminal,
  run `bm reindex` after adding or editing notes outside of MCP. Use
  `bm reset` only to rebuild from scratch (drops and recreates all tables).
