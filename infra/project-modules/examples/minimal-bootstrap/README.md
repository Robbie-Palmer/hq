# Minimal managed-project bootstrap

This canary connects the repository's public Copier, account-foundation, and
project-infrastructure commands. It is disposable. Its profile selects a web
application plus a Worker and Neon database, while OCI, Kubernetes, Flux,
NixOS, self-managed targets, automatic Cloudflare token creation, telemetry,
object storage, and feature flags remain out of scope.

The profile is the source of truth. `infrastructure-profile.json` is the small
projection consumed by Terraform. The project-generator test fails if that
projection no longer matches the profile resolved at
`2026-10-27T00:00:00Z`.

## Check the repository change

Run the same commands used for maintained projects:

```bash
mise //:project:profile:resolve -- \
  infra/project-modules/examples/minimal-bootstrap/project-profile.yaml \
  --effective-at 2026-10-27T00:00:00Z

mise //:project:profile:dry-run -- \
  infra/project-modules/examples/minimal-bootstrap/project-profile.yaml \
  --effective-at 2026-10-27T00:00:00Z
```

The committed Copier receipt and shared-manifest registrations are the result
of applying this profile. The dry run must show no changes. To re-prove apply
and repeatability, use a disposable clone or worktree, remove only the canary's
receipt and registrations, run `profile:create`, then run `profile:plan`. The
second plan must contain no changed paths.

## Create the protected foundation

The account-foundation root keeps this canary's administrative resources in
its existing protected HCP state. The fixture adds one disposable HCP project
and workspace, one Doppler project with `preview` and `apply` environments,
and two GitHub environments.

```bash
mise //infra/account-foundation:minimal-bootstrap:plan
mise //infra/account-foundation:minimal-bootstrap:show
mise //infra/account-foundation:minimal-bootstrap:apply
mise //infra/account-foundation:minimal-bootstrap:plan
```

Review the saved plan before apply. It may create only resources named
`platform-bootstrap-canary`. The second plan must report no changes.

The first run needs the same account-foundation plan and apply credentials as
the ordinary root. A human must then put the canary's HCP, Cloudflare, and Neon
credentials plus these non-secret variables into the new Doppler configs:

- `TF_VAR_cloudflare_account_id`
- `TF_VAR_neon_org_id`
- `TF_VAR_reviewer_emails`, encoded as a Terraform set value

Do not put provider credentials in Terraform variables or committed files.
The profile's pending fulfillment checkpoints record the Access identity
provider, reviewer policy, preview credentials, synthetic-data setup, and
smoke tests.

## Plan and apply the isolated preview

The application root uses the HCP workspace created above. It creates a Pages
project whose production branch does not exist, a placeholder preview Worker,
an Access application, and separate empty Neon projects. Both Neon projects
use zero history retention. Nothing reads or clones production data.

```bash
doppler run --project platform-bootstrap-canary --config preview -- \
  mise //infra/project-modules:minimal-bootstrap:plan

mise //infra/project-modules:minimal-bootstrap:show

doppler run --project platform-bootstrap-canary --config apply -- \
  mise //infra/project-modules:minimal-bootstrap:apply

doppler run --project platform-bootstrap-canary --config preview -- \
  mise //infra/project-modules:minimal-bootstrap:plan
```

The first plan must contain only the five selected application capabilities.
The final plan must report no changes. The placeholder Worker returns 503 on
purpose. A later golden-path ticket owns application deployment and
authenticated read/write behavior.

## Cleanup

Remove application resources before deleting their HCP workspace:

```bash
doppler run --project platform-bootstrap-canary --config preview -- \
  mise //infra/project-modules:minimal-bootstrap:cleanup:plan

mise //infra/project-modules:minimal-bootstrap:cleanup:show

doppler run --project platform-bootstrap-canary --config apply -- \
  mise //infra/project-modules:minimal-bootstrap:cleanup:apply

mise //infra/account-foundation:minimal-bootstrap:cleanup:plan
mise //infra/account-foundation:minimal-bootstrap:cleanup:show
mise //infra/account-foundation:minimal-bootstrap:cleanup:apply
mise //infra/account-foundation:plan
```

Reject either cleanup plan if it updates, replaces, or deletes an address that
does not contain `platform-bootstrap-canary` or the application root's
`module.preview.module.disposable` prefix. The last account-foundation plan
must report no changes.

If an apply stops, keep the state and generate a new plan. Do not finish the
cleanup in provider consoles. If HCP state is unavailable, restore its latest
state version. If no state version survives, import every remaining provider
object into the same addresses and require a no-change plan before resuming.

## Checks and cost limits

```bash
mise //packages/project-generator:check
mise //infra/project-modules:check
mise //infra/account-foundation:test
```

The tests resolve the committed profile, reject credentials in the Copier
plan, apply each Terraform state twice, and remove every mocked canary
resource. The application and foundation stay in separate states.

Run the live proof only while the provider accounts have free capacity. It
uses one temporary HCP workspace, one Doppler project with two root configs,
two GitHub environments, one Pages project, one Worker, one Access
application, and two empty Neon projects. Stop before apply if any provider
quotes a paid upgrade. Clean up during the same operator session.
