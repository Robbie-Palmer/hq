# Remote development candidate cluster

This Terraform root creates the Kube-Hetzner candidate from
[ADR 012](../../ui/content/projects/agent-friendly-remote-development/adrs/012-kube-hetzner-evaluation.mdx).
It has separate Terraform state and must use a separate Hetzner project. Nothing
in this root imports, reads, or changes the current `remote-development` server,
volume, firewall, or Terraform workspace.

## Topology

Kube-Hetzner `3.1.0` creates three `cx23` control-plane nodes across `nbg1`,
`fsn1`, and `hel1`. Two `cx33` agents each have a stable workspace label and a
`NoSchedule` taint. The committed workspace manifests bind each T3 Code pod to
its assigned agent.

Nodes keep public IPs for outbound package traffic and direct Tailscale
transport. Hetzner firewalls expose neither SSH nor the Kubernetes API. There
is no ingress load balancer. Operators reach the API, SSH, and NodePort
workspace endpoints through Tailscale MagicDNS.

Each workspace requests a 90 GiB Hetzner CSI volume through a storage class
with `Retain` reclaim policy. Its 20 GiB cache is an `emptyDir` and may disappear
with the pod or node. The durable volume contains T3 state, authentication
homes, and worktrees. [`workspaces/inventory.json`](workspaces/inventory.json)
records placement, endpoint, volume, owner, and backup-set names without
credentials.

K3s encrypts Kubernetes Secrets before it writes them to etcd. It uploads a
compressed etcd snapshot every six hours to S3-compatible storage outside the
cluster and retains 14 snapshots. Workspace backups remain independent of etcd
snapshots.

## Prerequisites

Create these resources before the first plan:

1. A separate Hetzner project and a read/write API token. Do not reuse the
   project that contains the current NixOS VPS.
2. Terraform Cloud workspace `personal-site-remote-development-cluster`, using
   local execution. This workspace already exists.
3. A Tailscale OAuth client that may create
   `tag:remote-dev-control-plane`, `tag:remote-dev-agent`, and
   `tag:remote-dev-build-agent` devices. Tailnet ACLs must let the operator
   reach tagged devices on TCP 22, 6443, 30773, and 30774.
4. An S3-compatible bucket and credentials scoped to the
   `remote-development-candidate/` prefix.
5. Doppler config `homelab/prd_remote_development_cluster`. The config already
   exists with the Terraform token, SSH public key, tailnet domain, and S3
   region. Add the missing credentials below before provisioning:

   | Name | Exposure | Purpose |
   | --- | --- | --- |
   | `HCLOUD_TOKEN` | secret | Candidate Hetzner project only |
   | `TF_API_TOKEN` | secret | Candidate Terraform Cloud workspace |
   | `SSH_PUBLIC_KEY` | plain | Recovery public key |
   | `SSH_PRIVATE_KEY` | secret | Provisioner key, or omit when using `ssh-agent` |
   | `LEAPMICRO_X86_SNAPSHOT_ID` | plain | Set by the snapshot task |
   | `TAILSCALE_OAUTH_CLIENT_SECRET` | secret | Tagged node enrolment |
   | `TAILSCALE_MAGICDNS_DOMAIN` | plain | Tailnet `*.ts.net` domain |
   | `ETCD_S3_ENDPOINT` | plain | Snapshot endpoint |
   | `ETCD_S3_ACCESS_KEY` | secret | Bucket-scoped key ID |
   | `ETCD_S3_SECRET_KEY` | secret | Bucket-scoped secret |
   | `ETCD_S3_BUCKET` | plain | Snapshot bucket |
   | `ETCD_S3_REGION` | plain | S3 region, normally `auto` for R2 |

Do not store a kubeconfig, API token, SSH key, or S3 key in Git. Terraform state
contains sensitive bootstrap material, so access to the candidate workspace
must stay restricted.

## Create and verify

Run all tasks through mise:

```bash
mise run //infra/remote-development-cluster:check
mise run //infra/remote-development-cluster:snapshot
mise run //infra/remote-development-cluster:plan
mise run //infra/remote-development-cluster:apply
mise run //infra/remote-development-cluster:kubeconfig
mise run //infra/remote-development-cluster:deploy-workspaces
mise run //infra/remote-development-cluster:verify
```

Review `.planfile` before apply. A valid candidate plan must mention only
resources in the separate candidate project. The apply needs an SSH key through
`SSH_PRIVATE_KEY` or a loaded `ssh-agent`, plus access to the tailnet once nodes
finish cloud-init.

The snapshot task builds the x86 Leap Micro image from the Kube-Hetzner `3.1.0`
template downloaded by Terraform init. It queries the newest matching snapshot
in the candidate project and writes only its numeric ID back to Doppler. Run it
once per reviewed Kube-Hetzner image update, not before every plan.

The verification waits for five Ready nodes, checks the CSI daemon, confirms
both PVCs are Bound, and proves each pod landed on its assigned agent. Inspect
etcd snapshot uploads separately in the S3 provider before calling the backup
gate complete.

## Private-access recovery

The generated kubeconfig uses the first control-plane MagicDNS name. If that
node fails, list the alternative names without exposing credentials:

```bash
mise run //infra/remote-development-cluster:output-control-planes
```

Copy the kubeconfig, replace only its server host with another listed
control-plane name, then run `kubectl get --raw=/readyz`. Keep the original CA
data and credentials.

If Tailscale enrolment fails on every node, use Hetzner's browser console in the
candidate project. Check `tailscaled`, verify the OAuth client and tag owners,
then rerun the saved Terraform plan after restoring tailnet access. Public SSH
and API rules stay closed during recovery. The provider console is the recovery
path, not a temporary `0.0.0.0/0` firewall rule.

For etcd disaster recovery, follow K3s snapshot restore procedure with one of
the objects under `remote-development-candidate/`. Stop the other server nodes,
restore the selected snapshot on one server with the original cluster token,
start that server, then rejoin or replace the other two. Test this on a copied
candidate before using it after real data loss.

## Destroy

The current VPS remains untouched when this candidate is destroyed:

```bash
mise run //infra/remote-development-cluster:destroy-plan
mise run //infra/remote-development-cluster:destroy
```

Review `.destroy-planfile`. The CSI storage class uses `Retain`, so delete or
export retained workspace volumes explicitly after checking their backup sets.
Deleting the cluster must not become an accidental workspace-data deletion.

## Cost and operating comparison

The figures below use the Hetzner project pricing API on 2026-09-26. They are
monthly list prices before VAT. R2 usage and outbound overages are not included.

| Design | Compute | IPv4 | Durable volumes | Monthly total |
| --- | ---: | ---: | ---: | ---: |
| Candidate cluster | 3 × `cx23` at €5.49, 2 × `cx33` at €8.49 | 5 × €0.50 | 2 × 90 GiB at €0.0572/GiB | €46.25 |
| Current single-user VPS | 1 × `cx33` at €8.49 | 1 × €0.50 | 100 GiB at €0.0572/GiB | €14.71 |
| Two per-user VPSs | 2 × `cx33` at €8.49 | 2 × €0.50 | 2 × 100 GiB at €0.0572/GiB | €29.42 |

The candidate costs €31.54 more than the current host and €16.83 more than two
independent VPSs. At idle it keeps six control-plane vCPUs, eight agent vCPUs,
12 GiB of control-plane memory, and 16 GiB of agent memory running. The two T3
pods request only one vCPU and 2 GiB between them, before system workloads.

Kube-Hetzner owns Leap Micro images, K3s bootstrap, node replacement, CSI,
firewalls, and automated OS upgrades. The repository owner still owns module
upgrades, exact K3s upgrades, Tailscale policy, snapshot restores, CSI volume
backups, workload manifests, and replacement drills. A per-user VPS costs less
and has a smaller failure domain. Keep it as the fallback unless the cluster's
shared control plane and node replacement save enough operator time to justify
the difference.
