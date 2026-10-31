# Workload definition contract

Generated from the version 1 schema and checked fixtures. Edit the source contract or fixtures, then regenerate this file.

## Contract boundary

The source records project and workload identity, one signed immutable release artifact, runtime intent, dependencies,
telemetry, environment overlays, and explicit deployment targets. Adapters may choose provider resource names and bindings.
They may not rewrite the source identity or artifact digest.

Provisioner state stays outside the contract and generated output. Compilation is deterministic for the same source and
maturity contract.

## Portable workload capabilities

- `immutable-artifact`
- `container-processes`
- `serverless-handlers`
- `scheduled-jobs`
- `ports`
- `http-health-checks`
- `resource-bounds`
- `configuration`
- `secret-references`
- `dependencies`
- `http-ingress`
- `horizontal-scaling`
- `persistence`
- `ordered-migrations`
- `otlp-telemetry`
- `environment-overlays`

A required capability that an adapter cannot preserve fails validation. A preferred capability produces a compiler warning.

## Deployment capability vocabulary

- `identity`
- `secrets`
- `networking`
- `storage`
- `databases`
- `telemetry`
- `backup`
- `deployment`
- `rollback`
- `incident_access`

Targets use the same capability names as the deployment maturity contract. Non-local targets must select a stage that
supports the workload shape and every required deployment capability.

## Target adapters

| Target kind | Source runtime | Output |
| --- | --- | --- |
| cloudflare-worker | cloudflare-worker | signed bundle, Wrangler inputs, binding references |
| docker-compose | container | Score v1b1 and Compose services |
| kubernetes | container | Score v1b1, ordinary resources, then Kustomize or optional Helm packaging |
| nixos-systemd-oci | container | signed OCI reference and systemd unit inputs |

## Checked examples

| Project | Workload | Runtime | Target | Adapter | Stage |
| --- | --- | --- | --- | --- | --- |
| representative-service | representative-service | container | local-compose | docker-compose | local |
| representative-service | representative-service | container | production-nixos | nixos-systemd-oci | nixos-host |
| representative-service | representative-service | container | production-kubernetes | kubernetes | kubernetes |
| edge-status | edge-status-api | cloudflare-worker | production-cloudflare | cloudflare-worker | serverless |
