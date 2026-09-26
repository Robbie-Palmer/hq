# Work Graph infrastructure

This Terraform root provisions the production Work Graph service. It owns the
Worker service name, custom domain, Cloudflare Access application and policy,
and the desired shape of the dedicated Neon project and Hyperdrive
configuration. HCP Terraform stores its state in the
`personal-site-work-graph` workspace.

## Why credentials bypass state

The Neon provider reads the default role password into state. Cloudflare's
Terraform resources do the same for an Access service-token secret and a
Hyperdrive origin password. Marking those attributes sensitive hides them from
normal output but does not remove them from state.

For that reason, this root uses three small API helpers during apply:

1. `provision-sensitive-resources.sh` creates or finds the Neon project,
   Hyperdrive configuration, and Access service token. It sends the database
   URL, public Hyperdrive ID, and token pair straight to Doppler config
   `work-graph/prd_work_graph`.
2. `read-resource-metadata.sh` returns only IDs, host, database, and role names
   to Terraform.
3. `install-hyperdrive-origin.sh` reinstalls the real Neon origin through
   Cloudflare's API when its coordinates change or after an operator requests
   a reinstall during password rotation.

The helpers disable shell tracing, place request and response bodies in a
mode-0700 temporary directory, pass bearer headers through mode-0600 curl
config files, and unlink every temporary file on exit. They never print secret
values. Terraform tracks only the Hyperdrive ID and origin-coordinate hash
because Cloudflare validates the password on creation but never returns it.

`mise run //infra/work-graph:state:check` rejects provider resources that return
credentials, provider-managed Hyperdrive resources, credential-bearing
PostgreSQL URLs, and sensitive outputs in the raw state.

## Why these helpers live here

`infra/bootstrap` is not a catch-all for setup code. It is a separate,
privileged root for the GCP IAM and Workload Identity Federation resources that
decide who may run the routine Terraform roots. Moving Work Graph lifecycle
code there would couple an ordinary service deployment to those broader
control-plane credentials.

These scripts stay beside the Work Graph resources because Terraform invokes
them during first apply and credential recovery. Only the three API helpers
above participate in the credential handoff; the remaining scripts are the
same kind of plan wrapper, validation, and state checks used by the other
infrastructure roots.

Ansible is useful in this repository when configuring machines over SSH and
bridging host migrations. This flow has no hosts to configure: it talks to
SaaS APIs and hands one-time credentials directly to Doppler. An Ansible
playbook would still need custom HTTP or command tasks for those APIs, while
adding Python and collection dependencies to the Terraform runner. The narrow
shell helpers keep the secret handoff explicit and use only tools already
required by the workflow (`bash`, `curl`, `jq`, and Doppler).

## One-time prerequisites

Create these before the first apply:

- HCP Terraform workspace `personal-site-work-graph`, set to local execution.
- Doppler project `work-graph`, with configs `prd_work_graph_infra` and
  `prd_work_graph`. The separate project avoids coupling Work Graph access to
  the personal-site runtime configs.
- GitHub environments `production-work-graph-infra` and
  `production-work-graph`. Restrict both environments to protected branches
  without required reviewers so merges to `main` deploy automatically.
- A Doppler service token that can update `prd_work_graph`. Store it only as
  masked `WORK_GRAPH_DOPPLER_SERVICE_TOKEN` in `prd_work_graph_infra`.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`,
  `NEON_ORG_ID`, and `TF_API_TOKEN` in `prd_work_graph_infra`.

The Cloudflare infrastructure token needs product-level Workers admin because
the first apply creates the bootstrap Worker. It also needs Hyperdrive edit,
Access Apps and Policies edit, and Access Service Tokens edit at the account
scope. Grant Zone read and Workers Routes edit only for `robbiepalmer.me`.
After Terraform creates the Worker, the separate application deployment token
needs only Workers editor access scoped to `work-graph-api`; it does not need
admin access. The Neon key must create and inspect projects in `NEON_ORG_ID`.

Create the target `prd_work_graph` config first. Terraform tests write access
before creating either one-time credential. A failed test stops the apply
before Neon or Cloudflare returns a credential.

Sync the infrastructure config to its matching GitHub environment:

```bash
scripts/sync-doppler-github-envs.sh production-work-graph-infra
```

Pull-request CI validates formatting, Terraform configuration, shell syntax,
and the credential boundary without provider credentials. Merges that change
`infra/work-graph/**` create and apply a saved Terraform plan automatically
from protected `main`. Manual dispatch from `main` reruns the same
plan-and-apply flow.

## Plan and apply

Run every command through mise:

```bash
mise run //infra/work-graph:format
mise run //infra/work-graph:check
mise run //infra/work-graph:apply
```

When applying locally, review `.planfile` before applying. The protected
main-branch workflow records its plan in the run summary and applies that same
plan automatically. The first apply returns IDs and other public metadata in
its outputs. It writes these runtime values to `prd_work_graph`:

- `DATABASE_URL`
- `WORK_GRAPH_HYPERDRIVE_ID`
- `WORK_GRAPH_API_URL`
- `WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS`
- `WORK_GRAPH_NEON_PROJECT_ID`
- `WORK_GRAPH_CF_ACCESS_SERVICE_TOKEN_ID`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

Keep `DATABASE_URL`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`
masked. The other values may remain masked too. Sync `prd_work_graph` to the
`production-work-graph` GitHub environment only after the apply and state check
both pass.

Terraform first deploys a 503 bootstrap Worker. Application deployment through
`workers/work-graph-api` replaces that module and disables its `workers.dev`
address. Until then, Access protects the custom domain and the Worker returns
no application data.

## Rotation and recovery

`terraform destroy` is unsupported for this root because Terraform does not own
the externally created Neon project, Hyperdrive configuration, or Access
service token. To retire the credential handoff, first revoke
`work-graph-agents` and delete `work-graph-db` in Cloudflare. Then remove only
the generated runtime entries from Doppler:

```bash
doppler secrets delete --yes --project work-graph --config prd_work_graph \
  DATABASE_URL WORK_GRAPH_HYPERDRIVE_ID WORK_GRAPH_API_URL \
  WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS WORK_GRAPH_NEON_PROJECT_ID \
  WORK_GRAPH_CF_ACCESS_SERVICE_TOKEN_ID \
  CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
```

Do not delete the Neon project. Retain it for backup, recovery, or an explicit
data-migration decision separate from Terraform retirement.

Rotate the Access credential with the shared overlap-safe helper:

```bash
mise run //infra/work-graph:access:rotate
```

The task calls the shared overlap-safe rotation helper with the Work Graph
config and token name. The previous secret remains valid for seven days so
clients can refresh their Doppler environment before the old value expires.

Resetting the Neon role password requires a Hyperdrive reinstall. Update
`DATABASE_URL` in Doppler, then force only the installer and apply the reviewed
plan:

```bash
mise run //infra/work-graph:plan -- \
  -replace=terraform_data.hyperdrive_credentials
mise run //infra/work-graph:apply
```

Never delete the Neon project as part of ordinary Terraform recovery. The
credential handoff has no destroy operation, so removing Terraform state does
not remove its database. If someone deletes the project out of band, replace
`terraform_data.credential_handoff`, review the resulting empty-database plan,
and restore data before deploying the Worker.
