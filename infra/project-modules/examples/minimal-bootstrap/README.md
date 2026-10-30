# Minimal managed-project bootstrap

This canary connects the repository's public Copier, account-foundation, and
project-infrastructure commands. It is disposable. Its profile selects a web
application plus a Worker and Neon database, while OCI, Kubernetes, Flux,
NixOS, self-managed targets, automatic Cloudflare token creation, telemetry,
object storage, and feature flags remain out of scope. The fixture has no
public project page or knowledge-graph record. The shared site mounts its
project-owned UI at `/platform-bootstrap-canary`, and the disposable provider
preview uses a separate temporary URL.

The profile is the source of truth. `infrastructure-profile.json` is a small
reviewed projection used to check the canary selections; Terraform no longer
interprets that selection set at runtime. The project-generator test fails if
the projection no longer matches the profile resolved at
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
the ordinary root. A human must then issue separate credentials for the two new
Doppler configs. Give `preview` read-only credentials for refresh and plan, and
give `apply` write credentials for apply, deploy, and teardown. Do not copy a
write-capable credential from `apply` into `preview`. Both configs need their
own values for:

- `TF_API_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `NEON_API_KEY`

Set these non-secret values in both configs:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `NEON_ORG_ID`
- `MINIMAL_BOOTSTRAP_REVIEWER_EMAIL`

Do not put provider credentials in Terraform variables or committed files.
The profile's pending fulfillment checkpoints record the Access identity
provider, reviewer policy, preview credentials, synthetic-data setup, and
smoke tests.

## Plan and apply the isolated preview

The application root uses the HCP workspace created above. It creates a Pages
project whose `bootstrap-canary` production branch contains only the disposable
fixture, a preview Worker, Access applications for its custom domain and every
Pages deployment hostname, and separate empty Neon projects. Both Neon projects
use zero history retention. Nothing reads or clones production data.

The public mise tasks load the `preview` config for read-only plans and the
`apply` config for writes. Their wrapper maps the readable names above to the
Terraform variables without printing secret values. The fixture composes
separate disposable Cloudflare and Neon modules, so Terraform never configures
GitHub, Doppler, TFE, or PostHog for its plan, apply, or cleanup. Production
project roots use the equivalent Copier-compiled capability modules with
deletion protection.

```bash
mise //infra/project-modules:minimal-bootstrap:plan
mise //infra/project-modules:minimal-bootstrap:show
mise //infra/project-modules:minimal-bootstrap:apply
mise //infra/project-modules:minimal-bootstrap:deploy
mise //infra/project-modules:minimal-bootstrap:smoke:database
mise //infra/project-modules:minimal-bootstrap:smoke:preview
mise //infra/project-modules:minimal-bootstrap:smoke:worker
mise //infra/project-modules:minimal-bootstrap:plan
```

The first plan after the provider-boundary refactor records state moves from
the former aggregate module into the Cloudflare and Neon modules. Those moves
must not recreate a remote object. Every plan must contain only the five
selected application capabilities.
The Pages deploy publishes a single synthetic-data notice on the
`bootstrap-canary` branch. The HTTP smoke checks both the custom domain and the
latest immutable Pages deployment URL, so a hash URL cannot bypass Access. The
Worker smoke reads a small JSON health
response from `bootstrap-canary-worker.robbiepalmer.me` and checks that it
contains only its project, environment, and data classification.
The database smoke opens the sensitive Neon
connection URI directly from Terraform output, creates a temporary table,
writes and reads one synthetic row in a transaction, then disconnects without
printing the URI. The HTTP smoke proves that Cloudflare Access rejects an
unauthenticated request. A reviewer must also open the preview in a browser and
complete the configured identity-provider login before cleanup. The final plan
must report no changes.

## Cleanup

Remove application resources before deleting their HCP workspace:

```bash
mise //infra/project-modules:minimal-bootstrap:cleanup:plan
mise //infra/project-modules:minimal-bootstrap:cleanup:show
mise //infra/project-modules:minimal-bootstrap:cleanup:apply
mise //infra/account-foundation:minimal-bootstrap:cleanup:plan
mise //infra/account-foundation:minimal-bootstrap:cleanup:show
mise //infra/account-foundation:minimal-bootstrap:cleanup:apply
mise //infra/account-foundation:plan
```

Reject either cleanup plan if it updates, replaces, or deletes an address that
does not contain `platform-bootstrap-canary` or the application root's
`module.cloudflare` or `module.neon` prefix. The application plan may also
forget the legacy `module.preview.terraform_data.profile_guard` address without
destroying it. The cleanup apply fails if any managed address remains. The last
account-foundation plan must report no changes. HCP can delete the workspace
only after the application state contains no provider resources.

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
two GitHub environments, one Pages project, one Worker, three Access
applications, and two empty Neon projects. Stop before apply if any provider
quotes a paid upgrade. Clean up during the same operator session.
