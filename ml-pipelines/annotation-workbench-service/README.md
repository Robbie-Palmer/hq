# Annotation Workbench service

This FastAPI service validates a versioned review bundle, serves its confined
image assets, and appends reviewer events to JSON Lines. It has no model or
dataset dependency.

Dataset adapters create bundles. The first adapter lives in the NuCLS cell
analysis benchmark and records CellSAM and SAM 2.1 mask proposals without
changing source annotations.

Run all commands through mise:

```sh
mise //ml-pipelines/annotation-workbench-service:lock
mise //ml-pipelines/annotation-workbench-service:check
mise //ml-pipelines/annotation-workbench-service:openapi:generate
mise //ml-pipelines/annotation-workbench-service:serve -- \
  --bundle=/absolute/path/to/bundle.json
```

The generated OpenAPI 3.1 contract is committed as `openapi.json`, checked for
drift, and linted with the repository's shared Spectral policy. Interactive API
documentation is available at `/api/docs` while the service is running.

The service binds to `127.0.0.1` by default. For temporary phone QA it can bind
to an explicit RFC 1918 or Tailscale `100.64.0.0/10` address:

```sh
mise //ml-pipelines/annotation-workbench-service:serve -- \
  --bundle=/absolute/path/to/bundle.json \
  --host=100.x.y.z \
  --allowed-origins=http://100.x.y.z:3000
```

Wildcard and public-address binds are rejected. Tailnet reachability is the
temporary QA boundary, not application-level authorization; add authenticated
reviewer identity before exposing this as a shared or public service.

On a Tailscale-connected workstation, one task starts both services and prints
the mobile URL:

```sh
mise //ml-pipelines/annotation-workbench-service:serve:tailnet -- \
  /absolute/path/to/bundle.json
```

Set `ANNOTATION_WORKBENCH_UI_PORT` when port `3000` already belongs to another
private service. The launcher uses the same port in the UI bind, printed URL,
and API CORS allowlist, and refuses to let Next.js silently choose another one.

```sh
ANNOTATION_WORKBENCH_UI_PORT=3001 \
  mise //ml-pipelines/annotation-workbench-service:serve:tailnet -- \
  /absolute/path/to/bundle.json
```

Review history is append-only and scoped by item and reviewer. A correction
names the event it supersedes, so stale browser tabs cannot silently replace a
newer decision.
