# Vector development workstation

This is the installation and commissioning runbook for `vector-development`,
the MSI Vector GP68HX described by
[ADR 025](/projects/homelab/adrs/025-graphical-nixos-development-workstation).
It installs NixOS 26.05, GNOME, Brave, T3 Code, Tailscale, and an independent
single-node K3s development plane.

[ADR 028](../../ui/content/projects/homelab/adrs/028-guarded-msi-ec-fan-control.mdx)
records why this host uses the out-of-tree `msi-ec` module and a guarded EC
write for its idle fan curve.

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
typed before erasing the disk and prompts twice for the LUKS passphrase. Read
the installer's Ed25519 host-key fingerprint on its local console before the
first connection.

```bash
export VECTOR_DEVELOPMENT_TARGET=root@192.0.2.10
export VECTOR_DEVELOPMENT_HOST_KEY_SHA256=SHA256:verified-console-fingerprint
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

Apply account foundation to create `personal-site/dev_agent_observability`.
Add `POSTHOG_PROJECT_ID`, set `POSTHOG_QUERY_HOST` to
`https://eu.posthog.com`, and add `POSTHOG_PERSONAL_API_KEY`. Create the key in
PostHog account settings, restrict it to this project, and grant only
`query:read` and `tracing:read`. Project secret API keys do not currently
support these scopes. Never use the administrative `POSTHOG_API_KEY` from
`personal-site/dev_infra` here.
Enter each value through Doppler's hidden interactive prompt:

```bash
doppler secrets set POSTHOG_PROJECT_ID \
  --project personal-site \
  --config dev_agent_observability \
  --visibility unmasked
doppler secrets set POSTHOG_QUERY_HOST \
  --project personal-site \
  --config dev_agent_observability \
  --visibility unmasked
doppler secrets set POSTHOG_PERSONAL_API_KEY \
  --project personal-site \
  --config dev_agent_observability \
  --visibility masked
```

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
the local HTTP endpoint. It also waits for DCGM Exporter, proves that the host
OpenTelemetry Collector has sent GPU metric points to Netdata, checks the
benchmark RBAC boundary, and runs the seven-day homepage Web Vitals query
through PostHog without printing the API key or query result.

Inside T3 Code, run `posthog-query homepage-vitals` for the homepage FCP, LCP,
INP, and CLS p75 values from the last seven days. Pipe a custom read-only query
to `posthog-query hogql`, or run `posthog-query apm-services` to list services
visible through PostHog tracing.

## GPU telemetry

NixOS owns the NVIDIA driver and container toolkit. The Vector overlay owns the
NVIDIA device plugin and a standalone DCGM Exporter DaemonSet. This keeps the
driver, runtime, device plugin, and telemetry ownership explicit.

The exporter image uses an immutable digest. Its reviewed counter list covers
utilization, framebuffer memory, clocks, clock-throttle reasons, temperature,
power, energy, PCIe retries, XID errors, and row remapping. The container runs
under the restricted Pod Security Standard with a read-only mount of the
kubelet pod-resources directory. That socket supplies the `pod`, `namespace`,
and `container` labels on metrics while a GPU workload is running. The exporter
and device plugin both use NVIDIA GPU UUIDs for this mapping.

The host OpenTelemetry Collector scrapes the ClusterIP Service through a
loopback-only K3s API proxy. It adds the `vector-development` cluster and
environment attributes, then exports metrics over OTLP to the local Netdata
agent. Netdata retains seven days and binds its dashboard to loopback. Use an
SSH forward when the dashboard is needed:

```bash
ssh -L 19999:127.0.0.1:19999 root@vector-development.tailaa0e46.ts.net
```

Open `http://127.0.0.1:19999` locally. NVIDIA documents the standalone
deployment and pod attribution in the
[DCGM Exporter installation guide](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html).

A 15-second host collector turns the DCGM and Kubelet signals into Netdata
health alarms. It reports a missing device plugin or metrics stream, loss of
allocatable GPU capacity, XID errors, thermal throttling, hardware power-brake
events, high temperature, and framebuffer pressure. Ordinary software power
capping remains a charted signal because Vector deliberately runs an eco power
profile.

## Bounded GPU benchmark Jobs

The permanent T3 Code controller does not reserve or receive the GPU. T3 Code
manages Jobs in `gpu-benchmarks`, and those Jobs receive exclusive access to
the device. Its Role permits Job create, read,
watch, and delete operations plus pod inspection and log reads. Benchmark pods
run under an inert service account, while the T3 launcher uses a short-lived,
namespace-scoped token.

The namespace applies the restricted Pod Security Standard and isolates
benchmark network traffic. A validating admission policy accepts the fixed
benchmark contract: the NVIDIA runtime, the Vector node, one container, one
GPU, a non-root security context, bounded CPU and memory, a digest-pinned image,
and a 1 GiB `emptyDir` mounted at `/tmp`. Jobs run once for at most 30 minutes
and expire within one hour.

Bundle benchmark inputs in the image. The launcher accepts digest-pinned images
under `nvcr.io/nvidia`, `docker.io/nvidia`, or `ghcr.io/robbie-palmer`. From a
Vector T3 Code session, run it from this repository:

```bash
mise run //homelab:vector-gpu-benchmark -- create smoke-001 \
  nvcr.io/nvidia/example@sha256:<64-hex-digest> -- --benchmark-argument
mise run //homelab:vector-gpu-benchmark -- status smoke-001
mise run //homelab:vector-gpu-benchmark -- logs smoke-001
mise run //homelab:vector-gpu-benchmark -- delete smoke-001
```

The Pathologize image pins NVIDIA's minimal CUDA runtime by digest, CuPy by
version, and the optional nvImageCodec JPEG and JPEG 2000 extensions. It
bundles the SHA-256-verified public CPTAC DICOM fixture. Build and check it,
then import it directly into Vector's K3s containerd. The import task prints
the immutable local reference accepted by the benchmark launcher:

```bash
mise run //homelab:pathologize-gpu-image-build-check
mise run //homelab:pathologize-gpu-image-load-vector
```

Run the experiment with the resolved manifest digest. Its JSON log separates
the correct CPU/OpenJPEG path, pinned host-to-device transfer, nvImageCodec
device decode, device preprocessing, and a deterministic linear-pooling GPU
proxy. It
also records the CPU decode and PNG encode path needed by tile viewers:

```bash
mise run //homelab:vector-gpu-benchmark -- create pathologize-decode-001 \
  ghcr.io/robbie-palmer/pathologize-gpu-benchmark@sha256:<64-hex-digest>
mise run //homelab:vector-gpu-benchmark -- logs pathologize-decode-001
```

The local import requires the guarded root SSH path because Docker and K3s use
separate image stores. It verifies Vector's hostname and location label before
writing to containerd, then checks the digest through the CRI. For shared or CI
runs, the optional `pathologize-gpu-image-push` task can publish the same image
to GHCR when a `write:packages` credential is available. The `ghcr.io` prefix
remains in the local image name so the admission contract has a stable,
repository-qualified OCI reference; the import path does not contact GHCR.

Use a unique run ID for each Job. The launcher writes the same run ID to the
Job and pod under `gpu-benchmark.homelab.dev/run-id`. DCGM emits the generated
pod name, namespace, and container name from the kubelet pod-resources socket,
so the run can be matched to GPU samples. Benchmark output must go to stdout or
stderr; `/tmp` is deleted with the pod.

Run the pinned CUDA vector-add smoke test after GPU stack changes. The command
waits for a successful kernel execution, prints the result, and deletes its
Job:

```bash
mise run //homelab:vector-gpu-benchmark -- smoke
```

`vector-health` runs the same smoke test after checking the driver, runtime,
device plugin, and telemetry pipeline.

For an unprivileged Nsight Systems trace, use an approved image that contains
both `nsys` and the target application:

```bash
mise run //homelab:vector-gpu-benchmark -- profile trace-001 \
  ghcr.io/robbie-palmer/example@sha256:<64-hex-digest> -- \
  python train.py
mise run //homelab:vector-gpu-benchmark -- logs trace-001
```

The launcher disables CPU sampling, fixes the CUDA, NVTX, and OS-runtime trace
set, and prints statistics to the Job log. It does not grant performance-counter
access or `CAP_SYS_ADMIN` to T3 Code workloads.

Run the administrator-only DCGM level-1 diagnostic after driver upgrades or
when an XID or CUDA smoke failure needs hardware evidence:

```bash
mise run //homelab:vector-gpu-diagnostic
```

That task runs the digest-pinned DCGM image over SSH with no network or host
mounts. The temporary container alone receives `CAP_SYS_ADMIN`, and Docker
removes it when the diagnostic exits.

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

The Vector overlay mounts the versioned controller policy, Cedar schema,
subsystem policy modules, and prompt at `/etc/agent-coordinator`. The JSON
manifest pins the exact Cedar bundle digest. The controller must stop if the
digest, schema validation, request validation, or policy evaluation fails.
T3 Code remains a private NodePort reached through the tailnet. Do not add a
public Kubernetes Ingress, Gateway, LoadBalancer, or a second Cloudflare
Tunnel. T3 Connect supplies the public webhook URL and holds requests while
Vector is offline.

Create one persistent controller thread in the `hq` project and bind one
disabled webhook task to it. Copy the task schedule from
`controller-policy.json`. Configure the GitHub webhook with JSON content and
the same secret as the task's HMAC-SHA256 signature. Subscribe only to
`dependabot_alert`. The task must retain its repository, action, severity, and
alert-number filters, `X-GitHub-Delivery` replay key, and 15-minute delivery age
limit.

Reconcile the repository webhook with the checked-in task. Supply the T3
Connect URL and both secrets through the environment and private files so they
do not enter Git, Terraform state, command arguments, or logs:

```bash
CONTROLLER_WEBHOOK_URL="https://relay.t3.codes/v1/hooks/..." \
CONTROLLER_WEBHOOK_SECRET_FILE=/private/path/hmac-secret \
CONTROLLER_GITHUB_TOKEN_FILE=/private/path/github-token \
CONTROLLER_WEBHOOK_ACTIVE=false \
  mise run //homelab:vector-controller-webhook-configure
```

`CONTROLLER_GITHUB_TOKEN_FILE` must contain a separate, short-lived fine-grained
token limited to `Robbie-Palmer/hq` with repository **Webhooks: Read and write**.
Do not use the ordinary Vector agent token for this commissioning operation.
The HMAC secret file must contain the exact secret without a terminal newline.

The commissioning command is idempotent for the exact T3 Connect URL. It
creates the hook inactive, or reconciles that hook without modifying other
repository hooks. Keep the GitHub hook inactive while running the admission
matrix directly against the T3 Connect URL.

The controller uses one Cedar decision point with separate policy modules for
GitHub, T3 Code, Work Graph, and deployment operations. It evaluates concrete
provider actions against current resource facts. A Cedar permit, the relevant
credential or runtime capability, and the provider's own controls must all
allow an operation. Any denial or unknown result stops it.
Repository writes must use a controller-owned non-default ref. Cedar forbids
direct default-branch writes, while the GitHub ruleset remains an independent
provider-side control.

Run the admission test before enabling unattended incident work. Enable the T3
webhook task while leaving the GitHub hook inactive. Send a signed candidate
with a unique delivery ID, then repeat that request with the same ID. Also send
an invalid signature, a wrong repository, an out-of-policy severity, an
out-of-policy action, and a relay-held request older than 15 minutes. Inspect
T3 Code's delivery records and the bound thread. The candidate must reach the
controller exactly once. The other requests must not start a controller turn
or worker thread. If any case fails, disable the T3 task and leave the GitHub
hook inactive. Only after every case passes, keep the task enabled and rerun
the guarded commissioning command with `CONTROLLER_WEBHOOK_ACTIVE=true` to
enable normal GitHub delivery.

Deploy later host changes from another tailnet member:

```bash
mise run //homelab:vector-rebuild
```

GNOME automatic suspend is disabled on both battery and external power. Closing
the lid on battery still suspends the laptop. On external power or while docked,
closing the lid leaves the machine running. Host activation refreshes the active
GNOME power daemon so a logged-in session cannot retain the old idle timeout
after a rebuild.

The MSI firmware starts the CPU fan at 60°C in advanced fan mode. The 50°C
monitor point captures the observed lower edge of its release hysteresis.
The guarded curve service changes only the first two CPU temperature
thresholds and keeps the factory fan speeds and every threshold from 64°C
upward. It reapplies the curve after resume. Stopping the service, including a
rollback to a generation that does not contain it, restores the factory
thresholds and silent fan mode. The helper refuses EC writes unless the laptop
model, board, firmware, and complete factory fan data match the verified Vector
values.

The thermal monitor keeps fourteen days of one-minute samples in
`/var/lib/vector-development-thermal-monitor/history.jsonl`. It also logs every
configured CPU temperature threshold crossing, the 50°C release point, fan
starts and stops, and changes to the EC fan percentage in the system journal.

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
