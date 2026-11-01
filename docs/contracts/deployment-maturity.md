# Deployment maturity contract

Generated from contract version 1. The governing decision is `personal-engineering-platform:047-deployment-maturity-contract`.

## Promotion invariants

Project identity fields:

- `project.id`
- `project.catalog_id`
- `project.owner`

Workload fields:

- `workload.id`
- `workload.runtime_family`
- `workload.ports`
- `workload.health`
- `workload.dependencies`
- `workload.telemetry.service_namespace`
- `workload.telemetry.service_name`

Release fields:

- `release.id`
- `release.artifact.repository`
- `release.artifact.digest`
- `release.artifact.signature.signer`

Target adapters own these fields:

- `deployment.stage`
- `deployment.adapter`
- `deployment.provider`
- `deployment.resource_names`
- `deployment.scaling`
- `deployment.network_binding`
- `deployment.secret_binding`
- `deployment.storage_binding`
- `deployment.database_binding`
- `deployment.rollback_mechanism`
- `deployment.incident_access`

## Availability rule

A stage may claim high availability only after capacity, failover, and recovery tests cover at least two failure
domains. Version 1 makes no high-availability claim.

## 1. Serverless

Adapter family: `serverless`

Supported workload shapes: static-site, request-driven-service, scheduled-job, event-consumer.

Ownership: application: project, runtime: provider, control plane: provider, data: shared, incident response: shared.

### Serverless entry criteria

- The workload fits the provider's runtime, request, protocol, and execution limits. Evidence: contract-check.
- Durable state uses a managed service or object store outside the compute instance. Evidence: contract-check.
- A signed artifact and automated deployment can recreate the workload. Evidence: runtime-test.

### Serverless exit triggers

- A required runtime, protocol, background process, or execution duration exceeds provider limits. Evidence:
  runtime-test.
- Incident recovery needs host, network, or scheduling control that the provider does not expose. Evidence:
  recovery-exercise.
- Measured consumption cost exceeds an operated target for the same workload and recovery objective. Evidence:
  cost-record.

### Serverless cost and recovery assumptions

Cost model: consumption. Idle cost: zero.

- Compute cost follows requests, execution time, storage, and network transfer.
- Managed data and telemetry can retain a non-zero baseline when compute is idle.

Availability claim: not-claimed.

- Recovery depends on provider service restoration or redeployment of the signed artifact.
- Data loss follows the external data service's proved backup and recovery behavior.

### Serverless required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | delegated | provider | Bind workload identity without storing long-lived provider credentials in the artifact. |
| secrets | delegated | provider | Resolve secret references at deployment or runtime and keep values outside source and artifacts. |
| networking | delegated | provider | Route the stable public URL to the current release and enforce declared private egress or service bindings. |
| storage | unsupported | project | Reject workloads that require durable instance-local or attached POSIX storage. |
| databases | delegated | provider | Use an external managed database with stable logical identity and tested credentials. |
| telemetry | required | project | Preserve the workload's OpenTelemetry service identity and export path. |
| backup | delegated | shared | Record the external data service's backup owner, retention, restore procedure, and latest exercise. |
| deployment | required | platform | Verify the signed artifact, deploy immutably, and retain deployment evidence. |
| rollback | required | platform | Restore the previous immutable artifact and compatible configuration without changing the public URL. |
| incident access | delegated | provider | Provide deployment logs, runtime logs, metrics, and provider status without host access. |

## 2. Managed application runtime

Adapter family: `managed-application`

Supported workload shapes: request-driven-service, background-worker, scheduled-job, event-consumer.

Ownership: application: project, runtime: provider, control plane: provider, data: shared, incident response: shared.

### Managed application runtime entry criteria

- The workload has a signed OCI artifact, explicit process, ports, health checks, and resource bounds. Evidence:
  contract-check.
- Stateful dependencies have managed bindings and do not depend on instance identity. Evidence: contract-check.
- The target adapter has restored the previous artifact in a test environment. Evidence: runtime-test.

### Managed application runtime exit triggers

- The workload needs kernel, filesystem, private-network, or service-manager control outside the runtime contract.
  Evidence: runtime-test.
- Placement, topology, or workload isolation requirements exceed the managed scheduler. Evidence: contract-check.
- Measured steady-state cost exceeds an operated host or cluster for the same recovery objective. Evidence: cost-record.

### Managed application runtime cost and recovery assumptions

Cost model: subscription. Idle cost: variable.

- Cost includes reserved runtime capacity, managed build or deploy features, storage, and network transfer.
- Scale-to-zero behavior is target-specific and must be measured rather than assumed.

Availability claim: not-claimed.

- Recovery uses provider rescheduling or redeployment of the signed artifact.
- Data loss follows the external data service's proved backup and recovery behavior.

### Managed application runtime required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | delegated | provider | Bind a target service identity to the invariant workload identity. |
| secrets | delegated | provider | Inject referenced secrets at runtime without adding them to the image or deployment record. |
| networking | delegated | provider | Preserve the public URL and declare private service and egress connections. |
| storage | delegated | provider | Use managed volumes only when the target documents lifecycle, backup, and replacement behavior. |
| databases | delegated | provider | Bind the invariant logical database through target-owned connection configuration. |
| telemetry | required | project | Preserve OpenTelemetry identity and verify traces, metrics, and logs after deployment. |
| backup | delegated | shared | Record data and volume backup ownership, retention, restore procedure, and latest exercise. |
| deployment | required | platform | Verify and deploy the immutable OCI digest with health-gated promotion evidence. |
| rollback | required | platform | Restore the previous digest and configuration through the managed release mechanism. |
| incident access | delegated | provider | Provide deploy events, logs, metrics, and a supported runtime diagnostic path. |

## 3. Self-managed NixOS host

Adapter family: `nixos`

Supported workload shapes: request-driven-service, background-worker, scheduled-job, event-consumer, stateful-service.

Ownership: application: project, runtime: platform, control plane: platform, data: shared, incident response: platform.

### Self-managed NixOS host entry criteria

- A measured runtime, network, filesystem, or cost need justifies operating a host. Evidence: cost-record.
- NixOS configuration, workload artifact, data bindings, and secret references can rebuild the host. Evidence:
  contract-check.
- A replacement-host exercise restores routing, data access, telemetry, and the signed artifact. Evidence:
  recovery-exercise.

### Self-managed NixOS host exit triggers

- Independent workloads need scheduling, resource isolation, or release coordination beyond systemd units. Evidence:
  runtime-test.
- Host replacement time or maintenance windows exceed the accepted recovery assumption. Evidence: recovery-exercise.
- Resource contention cannot be resolved with measured host resizing or workload limits. Evidence: runtime-test.

### Self-managed NixOS host cost and recovery assumptions

Cost model: host. Idle cost: fixed.

- Cost includes the host, attached storage, backups, network transfer, monitoring, and operator time.
- Spare capacity has value only when measured workloads can use it without breaking isolation.

Availability claim: single-instance.

- Recovery requires provisioning or repairing one host, restoring bindings, and redeploying the signed artifact.
- Data loss is bounded only by the latest tested external or volume backup.

### Self-managed NixOS host required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | required | platform | Map the invariant workload identity to a dedicated system user and scoped machine credentials. |
| secrets | required | platform | Materialize secret references at activation or runtime with restricted filesystem permissions. |
| networking | required | platform | Preserve public routing and declare firewall, private-network, DNS, and certificate state. |
| storage | required | platform | Declare volume lifecycle, mount ownership, capacity alerts, replacement, backup, and restore. |
| databases | required | shared | Bind an external database or declare a host-local database with explicit backup and recovery ownership. |
| telemetry | required | platform | Preserve OpenTelemetry identity and collect host, service, and deployment signals off-host. |
| backup | required | platform | Schedule backups and retain a dated restore exercise for every durable host resource. |
| deployment | required | platform | Verify the OCI signature and activate a pinned digest through a declarative systemd unit. |
| rollback | required | platform | Re-activate the previous digest and compatible NixOS generation without changing routing or data identity. |
| incident access | required | platform | Provide audited private shell access, an out-of-band recovery path, and off-host logs. |

## 4. Single-node K3s

Adapter family: `k3s`

Supported workload shapes: request-driven-service, background-worker, scheduled-job, event-consumer, stateful-service.

Ownership: application: project, runtime: platform, control plane: platform, data: shared, incident response: platform.

### Single-node K3s entry criteria

- Multiple workloads need Kubernetes APIs, isolation, or coordinated lifecycle on one operated host. Evidence:
  contract-check.
- The portable workload contract renders pinned, policy-checked Kubernetes resources. Evidence: contract-check.
- A clean node rebuild restores the control plane, workloads, routing, secrets, telemetry, and data bindings. Evidence:
  recovery-exercise.

### Single-node K3s exit triggers

- Measured workload demand or isolation cannot fit one node with safe headroom. Evidence: runtime-test.
- One-node maintenance or recovery time exceeds the accepted interruption window. Evidence: recovery-exercise.
- A proved requirement needs workloads distributed across independent nodes or failure domains. Evidence:
  contract-check.

### Single-node K3s cost and recovery assumptions

Cost model: host. Idle cost: fixed.

- Cost includes one node, storage, backups, network transfer, monitoring, upgrades, and operator time.
- Kubernetes control-plane overhead consumes part of the node and must be included in capacity checks.

Availability claim: single-instance.

- Recovery rebuilds one K3s node, restores cluster and data state, and reconciles workloads.
- Data loss is bounded only by the latest tested external, volume, and cluster-state backups.

### Single-node K3s required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | required | platform | Bind invariant workload identity to service accounts and scoped external credentials. |
| secrets | required | platform | Reconcile external secret references without committing values to Kubernetes resources. |
| networking | required | platform | Preserve public routing and declare ingress, service, network policy, DNS, and certificate state. |
| storage | required | platform | Declare storage classes, volume lifecycle, node affinity, capacity alerts, backup, and restore. |
| databases | required | shared | Bind an external database or declare an in-cluster database with tested single-node recovery. |
| telemetry | required | platform | Preserve OpenTelemetry identity and export workload, node, and control-plane signals off-node. |
| backup | required | platform | Back up cluster state and every durable volume, then record a full-node restore exercise. |
| deployment | required | platform | Verify the signed digest, render policy-checked resources, and record rollout evidence. |
| rollback | required | platform | Restore the previous resource revision and artifact digest with compatible data migrations. |
| incident access | required | platform | Provide audited cluster and node access plus off-node logs and recovery credentials. |

## 5. Multi-node K3s

Adapter family: `k3s`

Supported workload shapes: request-driven-service, background-worker, scheduled-job, event-consumer, stateful-service.

Ownership: application: project, runtime: platform, control plane: platform, data: shared, incident response: platform.

### Multi-node K3s entry criteria

- Capacity, isolation, or interruption evidence requires more than one schedulable node. Evidence: runtime-test.
- Workloads declare replicas, disruption behavior, placement, and storage topology. Evidence: contract-check.
- A node-loss exercise verifies rescheduling, routing, telemetry, data safety, and rollback. Evidence:
  recovery-exercise.

### Multi-node K3s exit triggers

- Control-plane scale, policy, tenancy, or upgrade requirements exceed the maintained K3s design. Evidence:
  runtime-test.
- A required operator, conformance target, or managed service does not support the selected K3s distribution. Evidence:
  provider-documentation.
- Measured K3s maintenance costs more than a conformant managed or full Kubernetes target. Evidence: cost-record.

### Multi-node K3s cost and recovery assumptions

Cost model: cluster. Idle cost: fixed.

- Cost includes every server and control-plane node, storage replication, backups, network transfer, monitoring,
  upgrades, and operator time.
- Spare nodes and replicas add cost before they prove an availability outcome.

Availability claim: not-claimed.

- Recovery depends on the tested control-plane quorum, node replacement, workload rescheduling, and data topology.
- Data loss follows the weakest tested external database, persistent volume, or cluster-state recovery path.

### Multi-node K3s required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | required | platform | Bind invariant workload identity to service accounts, nodes, and scoped external credentials. |
| secrets | required | platform | Reconcile external secret references with encryption, rotation, and namespace isolation. |
| networking | required | platform | Preserve public routing and declare ingress, service, network policy, DNS, certificates, and node connectivity. |
| storage | required | platform | Declare storage topology, replication behavior, node loss, capacity alerts, backup, and restore. |
| databases | required | shared | Bind external databases or prove in-cluster database topology, backup, failover, and restore behavior. |
| telemetry | required | platform | Preserve OpenTelemetry identity and export workload, node, network, storage, and control-plane signals. |
| backup | required | platform | Back up control-plane state and durable data, then exercise node and cluster restoration. |
| deployment | required | platform | Verify the signed digest, enforce placement and disruption policy, and retain rollout evidence. |
| rollback | required | platform | Restore the previous resource revision and digest without violating topology or data compatibility. |
| incident access | required | platform | Provide audited cluster and node access, off-cluster telemetry, and quorum recovery credentials. |

## 6. Kubernetes

Adapter family: `kubernetes`

Supported workload shapes: request-driven-service, background-worker, scheduled-job, event-consumer, stateful-service.

Ownership: application: project, runtime: platform, control plane: shared, data: shared, incident response: shared.

### Kubernetes entry criteria

- A proved scale, tenancy, policy, ecosystem, or managed-control-plane need requires conformant Kubernetes. Evidence:
  contract-check.
- Identity, secrets, network, storage, telemetry, backup, deployment, rollback, and incident access have named owners.
  Evidence: contract-check.
- A cluster recovery exercise restores routing, workloads, data bindings, telemetry, verification evidence, and
  rollback. Evidence: recovery-exercise.

### Kubernetes exit triggers

- Measured cluster and operator cost exceeds the value of the requirements that selected Kubernetes. Evidence:
  cost-record.
- A required capability lacks an owner, current evidence, or a tested recovery path. Evidence: contract-check.
- A lower stage now meets the workload, recovery, and cost requirements with less operational work. Evidence:
  contract-check.

### Kubernetes cost and recovery assumptions

Cost model: cluster. Idle cost: fixed.

- Cost includes the control plane, nodes, storage, load balancing, backups, network transfer, telemetry, upgrades, and
  operator time.
- Managed control planes remove selected tasks but do not remove workload, data, policy, or incident ownership.

Availability claim: not-claimed.

- Recovery depends on the proved control-plane, node-pool, routing, workload, and data-service procedures.
- Data loss follows the weakest tested database, persistent volume, object store, or control-plane recovery path.

### Kubernetes required capabilities

| Capability | Mode | Owner | Requirement |
| --- | --- | --- | --- |
| identity | required | shared | Bind invariant workload identity through service accounts, workload identity, node identity, and scoped external access. |
| secrets | required | shared | Reconcile external secret references with encryption, rotation, audit, and tenancy controls. |
| networking | required | shared | Preserve public routing and declare gateway, service, policy, DNS, certificate, egress, and failure-domain behavior. |
| storage | required | shared | Declare classes, topology, replication, expansion, replacement, backup, restore, and ownership for every volume. |
| databases | required | shared | Bind external databases or prove operator ownership, topology, failover, backup, restore, and upgrade behavior. |
| telemetry | required | shared | Preserve OpenTelemetry identity and export workload, cluster, network, storage, policy, and control-plane signals. |
| backup | required | shared | Back up cluster and durable data state with retention, off-cluster copies, and dated restoration evidence. |
| deployment | required | platform | Verify the signed digest, enforce admission and rollout policy, and retain target verification evidence. |
| rollback | required | platform | Restore compatible resources and the previous digest through a tested release mechanism. |
| incident access | required | shared | Provide audited control-plane, workload, node, and provider access with off-cluster recovery credentials. |

## Checked promotion example

Project `ledger-service` promotes release `release-2026-10-30-1` for workload `ledger-api`. Every target uses the same
project and workload identity, signed OCI digest, public URLs, logical data store, data schema, and OpenTelemetry
service identity.

| Stage | Adapter | Artifact digest | Rollback |
| --- | --- | --- | --- |
| serverless | managed-container-runtime | sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | managed-revision-switch |
| nixos-host | nixos-systemd-oci | sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | nixos-generation-reactivation |
| kubernetes | kubernetes-deployment | sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | deployment-revision-rollback |
