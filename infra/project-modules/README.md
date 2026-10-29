# Project infrastructure modules

This library maps a resolved project blueprint to provider resources. The
project generator and Copier workflow produce that blueprint today, but the
Terraform code does not invoke or depend on Copier. Another caller can use the
library if it implements the same versioned `project` and `selections`
contract. Provider identifiers, resource names, and credentials remain
separate inputs owned by the relevant Terraform root.

The `v1` directory is immutable apart from compatible fixes. Add `v2` before
changing a capability name, provider source, state address, input type, or
resource ownership rule in a way that requires callers to migrate state.

The [minimal bootstrap canary](examples/minimal-bootstrap/README.md) connects a
committed project profile to the v1 module and the protected account-foundation
state. It is the executable proof for the managed serverless path.

## Capability map

| Resolved profile selection | Provider resources | State scope |
| --- | --- | --- |
| `infrastructure.state-backend=terraform-cloud` | Protected HCP Terraform project and workspace | `bootstrap` |
| `delivery.ci=github-actions` | Doppler project, environments and empty configs; protected GitHub environments | `bootstrap` |
| `web-app.host=cloudflare-pages` | Cloudflare Pages project | `application` |
| `backend-api.runtime=cloudflare-workers` | Bootstrap Worker and optional custom domain | `application` |
| `security.preview-access=cloudflare-access` | Access application and reviewer policy | `application` |
| `storage.object-store=cloudflare-r2` | Project-owned R2 buckets | `application` |
| `network.public-ingress` | Project-owned DNS records | `application` |
| `database.relational-host=neon` | Production Neon project | `application` |
| `database.preview-isolation` | Separate empty Neon preview project | `application` |
| `observability.application-telemetry=posthog` | Project operations dashboard | `application` |

The module ignores unrelated selections. It rejects configuration for an
unselected capability and rejects a selected capability without configuration.
This makes profile removal visible in the next plan and prevents a populated
variable file from silently enabling infrastructure.

Container images, OCI registries, Kubernetes, Flux, NixOS, self-managed
deployment, and feature flags are deliberately outside the core library. This
is the long-term boundary between the minimal managed/serverless path and
self-managed infrastructure, not a temporary omission. Work Graph ticket
`pep-optional-infrastructure-module-extensions` tracks the extension modules.
Those modules must consume the same resolved profile and compose without
adding providers, state, or credentials to projects that do not select them.

## Compiled provider graph

New projects follow [ADR 044](/projects/personal-engineering-platform/adrs/044-compiled-terraform-provider-roots).
Copier writes `generated-project.tf` into the project's `terraform-root`
component. The file is Copier-owned and contains only the selected application
providers and capability modules. Do not edit it or add provider-subset
composition modules.

The aggregate `v1` source remains a compatibility surface for existing state.
Do not replace an existing aggregate module call with a compiled root during a
routine template update. New projects use compiled roots. A deliberate legacy
migration must keep the old provider configuration available for the destroy
or state-move phase, move each capability address under review, and reach a
no-change plan before removing the aggregate call.

## State boundaries

Use two module instances in two independently stateful roots. Do not combine
them in one state.

The account-foundation or equivalent bootstrap root uses
`state_scope = "bootstrap"`. It owns the downstream HCP workspace and the
empty Doppler and GitHub delivery containers. The workload root uses
`state_scope = "application"` after its remote backend exists. It owns Pages,
Workers, Access, R2, DNS, Neon, and telemetry resources.

Both roots may consume the same reviewed blueprint. Each scope filters the
selection set before checking configuration or creating modules. A profile can
therefore contain both bootstrap and application selections without granting
the bootstrap state access to workload providers.

```hcl
module "project_bootstrap" {
  source = "../../project-modules/v1"

  state_scope      = "bootstrap"
  resolved_profile = jsondecode(file("resolved-blueprint.json"))
  terraform_state = {
    organization      = "example"
    project_name      = "Example service"
    workspace_name    = "example-service"
    terraform_version = "1.16.4"
  }
  delivery = {
    doppler_project_name        = "example-service"
    doppler_project_description = "Example service delivery configuration"
    repository                  = "hq"
    environments = {
      plan = {
        doppler_environment_name = "Plan"
        doppler_configs          = ["plan"]
        github_environment_name  = "example-service-plan"
      }
      apply = {
        doppler_environment_name = "Apply"
        doppler_configs          = ["apply"]
        github_environment_name  = "example-service-apply"
        protected_branches       = true
      }
    }
  }
}
```

The application root uses the same pattern with
`state_scope = "application"` and only its selected workload configuration.
The module output `selected_capabilities` uses the same slot names as the
resolved profile. `resource_ownership` returns provider IDs grouped under the
profile project ID; it never returns secret values.

## Environments, data, and credentials

Use distinct module instances and remote workspaces for projects with separate
failure or access boundaries. Do not share the returned resource IDs between
project states unless the platform contract records that dependency.

The library applies these boundaries:

- Production and preview Pages variables are separate maps.
- Each R2 use case has a caller-owned map key and bucket name. Bucket resources
  use deletion protection.
- Neon production and preview use separate projects. The preview project starts
  with an empty `preview-base` branch. A delivery workflow creates and removes
  pull-request branches from that base.
- The module does not accept API tokens, database URLs, Worker secrets, Pages
  secrets, R2 access keys, or preview database keys. Configure providers through
  their environment variables. Route workload credentials through the secret
  bootstrap flow after the provider resource exists.
- Doppler configs are empty administrative containers. This module does not
  copy values into them or GitHub.

The [secret and identity bootstrap](../../docs/runbooks/project-secret-bootstrap.md)
automates items 1 through 4 where provider APIs allow it and records the rest
as resumable checkpoints. The fifth item stays with the relevant capability
module. Add it to Terraform when the pinned provider supports it. Until then,
record the manual provider action in the bootstrap plan.

1. Seed the account-foundation state and its administrator credentials.
2. Configure provider authentication for the protected plan and apply paths.
3. Create a preview-scoped Neon key, transfer it directly to the preview
   delivery secret owner, and test rotation without exposing the value to
   Terraform state or logs.
4. Register identity providers used by a project-specific Access application.
5. Configure provider features that the pinned provider cannot manage, such as
   an R2 lifecycle policy when its resource is unavailable.

## Plans, imports, and destructive changes

All durable resources use `prevent_destroy`. A rename or provider field that
forces replacement fails the plan instead of deleting the live object. Review
the replacement reason, choose an import or state move, and document the
exception before changing the lifecycle guard in a new module version.

`deletion_protection = false` selects separate resource addresses without
`prevent_destroy`. Use that mode only for a named disposable canary whose
creation and cleanup plans are reviewed together. It never changes the
addresses or lifecycle of the default protected resources.

Adopt existing resources one capability at a time:

1. Add the profile selection and matching configuration.
2. Run a saved plan. Confirm that it contains only the expected create actions.
3. Import the existing object at its complete module address. For example:

   ```bash
   terraform import \
     'module.project.module.cloudflare_r2["selected"].cloudflare_r2_bucket.bucket["uploads"]' \
     '<provider import id>'
   ```

4. Run a plan after import. It must report no changes before an apply is
   allowed. Repeat the plan after a refresh when a provider normalizes imported
   values asynchronously or documents eventual consistency.
5. Store the import evidence with the workload's operating record.

Provider import ID formats differ and can change. Use the documentation for
the pinned provider version. Never guess an ID from a display name.

Before a module upgrade or provider replacement, export recoverable state with
`terraform state pull` to an encrypted operator-controlled location and record
`terraform providers` plus the lock-file revision. Use `terraform state mv` for
address-only changes. Use `terraform state replace-provider` only after the new
provider has produced a reviewed no-change plan against a disposable or copied
state. Do not edit the state JSON by hand.

If state is lost, restore the latest protected state version first. If that is
not possible, initialize an empty workspace, import each durable provider
object at its declared address, and stop until a plan reports no changes.
Repeat after a refresh for providers with asynchronous normalization or
eventual consistency.

For a provider outage or account replacement, recover data into new provider
resources, import the new objects, then change DNS or runtime bindings. Never
destroy the old database or bucket as part of the provider cutover plan.

## Checks

Run the module checks through mise. The tests use Terraform mock providers and
never contact or apply to production providers.

These tasks stay in `infra/project-modules/mise.toml` because `infra/` is an
organizational directory containing independent Terraform states, not a
Terraform root. The module tasks also target the versioned `v1` directory;
inheriting a generic task from `infra/` would either run in the wrong directory
or hide which module contract it validates.

```bash
mise //infra/project-modules:format
mise //infra/project-modules:validate
mise //infra/project-modules:test
mise //infra/project-modules:lint
```
