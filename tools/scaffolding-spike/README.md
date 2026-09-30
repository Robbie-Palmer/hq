# Project generation spike

This disposable backend tests Backstage as the catalog and workflow interface,
with Copier underneath it. Run from the repository root:

```sh
mise //tools/scaffolding-spike:test
```

The task starts Backstage on `127.0.0.1:7483` and a repository-hosting substitute
on `127.0.0.1:7484`. Both ports must be free. It registers `template.yaml` through
the catalog API, waits for ingestion, invokes the scaffolder dry-run API, creates
a project through its task API, and waits for the resulting Component entity.
It then checks retries, changed inputs, path validation, and a Copier update
that conflicts with a committed local edit. It stops the servers on completion.
Each run leaves an ignored `.runtime/run-*/evidence.json` and the generated files
for inspection. No GitHub repository or deployed application is created.

The backend has authentication disabled and an in-memory database. It binds
only to loopback and is solely a spike fixture. The auxiliary HTTP server serves
only the template and generated catalog declarations. A production adapter
needs authenticated Backstage services, repository publishing, durable task
checkpoints, and catalog registration through the published repository URL.

Node and pnpm come from the root mise configuration. The spike mise configuration pins `uv`. Copier
is pinned to 9.18.2 and runs without trusted template hooks. Backstage dependencies
have exact versions and a separate pnpm lockfile so this experiment does not
change the application's dependency graph. Only the SQLite native dependency
may run an installation script. `resolve` updates this experiment's lockfile.

The experimental profile uses `pep-spike/v1`. Later tickets define the final
platform profile schema and dated-default resolver. The engine records the tagged
Copier source and non-secret answers. The profile is repository-owned, and the
catalog entity points to it. Later tickets own provisioning, deployment,
artifact signing, and the complete profile contract.

See [the evaluation](../../docs/scaffolding-tools-spike.md) for the proposed
Backstage contract and execution engine choices.
