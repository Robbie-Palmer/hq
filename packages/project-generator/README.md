# Project generator

This package runs Copier inside an existing monorepo without giving a template
ownership of the repository. It implements the engine selected by
[ADR 028](../../ui/content/projects/personal-engineering-platform/adrs/028-copier-monorepo-scaffolding.mdx).
The resolved-profile adapter compiles the current platform contracts into the
engine plan. The repository root is the production `monorepo-project` Copier
template; its configuration selects `copier-templates/monorepo-project` as the
copy root. The initial template records the resolved blueprint and receipt
without claiming existing product files.

## Commands

Run the engine through mise from the repository root:

```sh
mise //:project:plan -- path/to/plan.yaml
mise //:project:dry-run -- path/to/plan.yaml
mise //:project:create -- path/to/plan.yaml
mise //:project:update -- path/to/plan.yaml
```

`plan` emits JSON containing the operation, changed paths, checks, and binary
Git patch. `dry-run` prints the patch. `create` and `update` apply the same patch
to the current checkout after every check passes.

Use the profile commands when the source is a versioned project profile rather
than a prebuilt engine plan:

```sh
mise //:project:profile:plan -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:resolve -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:adoption-plan -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:reconcile -- path/to/profile.yaml --effective-at 2026-11-01T00:00:00Z
mise //:project:profile:reconcile:apply -- path/to/profile.yaml --effective-at 2026-11-01T00:00:00Z --reviewed-plan path/to/reconciliation.json
mise //:project:profile:dry-run -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:create -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:update -- path/to/profile.yaml --effective-at 2026-11-01T00:00:00Z --reviewed-plan path/to/reconciliation.json
```

These commands load the repository layout, platform manifest, Nix contract,
and OpenTelemetry contract from the Personal Engineering Platform project. The
explicit instant selects dated platform defaults. `--contracts`, `--registry`,
`--repository`, and `--template-id` replace their repository defaults when a
test or migration needs another input.

Set `project.published: false` for an internal fixture. Copier still records
its resolved blueprint and owns its declared component paths, but it does not
add the fixture to the public repository-layout or platform catalogs and does
not claim a project-content directory.

`profile:resolve` prints the complete non-secret blueprint consumed by Copier
and the versioned Terraform module library. Save that output only when a
reviewed infrastructure plan needs a stable input. Regenerate it from the same
profile and effective instant before reusing it.

`profile:adoption-plan` is for an existing project that has no Copier answers
file. It renders the pinned template in an empty temporary directory, then
compares that render with a snapshot of the checkout. The JSON result marks
template files as matching, adoptable, conflicting, or outside declared
ownership. Checkout-only files beneath an owned path are preserved as local
files. Shared-manifest edits, resolved profile overrides, task exceptions, and
the future receipt are listed separately. The command never changes the
checkout and reports `readyToAdopt: false` when a template file would overwrite
different content or escape declared ownership.

`profile:reconcile` compares the blueprint in an existing receipt with the
profile resolved at a later instant. Its JSON separates added, removed, and
replaced policies and defaults. Active project overrides remain visible as
manual decisions. The candidate includes the checked repository patch and a
digest over the repository revision, semantic changes, template revision, and
patch.

Save and review that JSON before running `profile:reconcile:apply`. Apply
rebuilds the plan and accepts it only when the digest still matches. A changed
checkout, profile, contract, template, or generated patch invalidates the
review. Receipt and typed shared-manifest edits count as automatic changes.
Other generated files count as migrations, including every infrastructure
path. `profile:update` is an alias for the same reviewed apply operation and
also requires `--reviewed-plan`.

Secret and identity bootstrap uses a separate versioned contract. Run
`mise //:project:secret-bootstrap:plan -- <plan.yaml>` to inspect a redacted
handoff, then `mise //:project:secret-bootstrap:apply -- <plan.yaml>` to resume
it. A manual provider action must be acknowledged with
`--acknowledge <checkpoint-id>` before the command moves its dependent value.
Plans that create Cloudflare account-owned tokens use the built-in
`cloudflare-account-token` extension. Run
`mise //:project:secret-bootstrap:conformance -- <plan.yaml>` before apply to
check the bootstrap token and declared permission groups without creating a
token.
See the [runbook](../../docs/runbooks/project-secret-bootstrap.md) and the
[example plan](../../infra/project-modules/examples/secret-bootstrap.yaml).

Keeping this contract separate matters. Project profiles and Copier receipts
stay deterministic and non-secret, while the resume file records only plan,
checkpoint, and completion IDs.

Profiles track newer defaults unless they state otherwise:

```yaml
reconciliation:
  mode: tracking
  defer:
    effective_at: "2026-11-01T00:00:00Z"
    reason: "Wait for the current migration window to close."
```

The defer record applies only to that exact target instant. Remove it or choose
a later instant to resume tracking. A completed project can stop updates:

```yaml
reconciliation:
  mode: frozen
  frozen_at: "2026-10-21T00:00:00Z"
  reason: "The project is complete and keeps its last accepted stack."
```

Frozen and deferred plans report the semantic differences but do not render,
check, or apply a candidate patch.

The default template registry is
`ui/content/projects/personal-engineering-platform/project-template-sources.yaml`.
Plans select a template ID from that registry. They cannot provide a template
URL or executable command. Profile commands also require the selected registry
entry to pin a full Git revision. Template revisions stay outside project
profiles.

The adapter records the complete resolved blueprint as a non-secret Copier
answer. When the blueprint contains one `terraform-root` component, the
template compiles its application capability selections into a static
`generated-project.tf`. Only selected provider requirements, configurations,
and module calls enter that root; Terraform does not receive the unselected
provider graph or its credentials. Provider support is added as an independent
template fragment rather than as combinations of providers.

Component paths become Copier-owned paths. The layout contract decides
which component kinds also become mise configuration roots or pnpm workspace
packages. Its task ownership policy marks each standard task as generated,
inherited from the existing mise hierarchy, or delegated to a named mise
project. A profile-level task exception overrides that policy only for a genuine
project-specific deviation. A hosted project UI stays inside the existing UI
workspace and delegates its checks to `//ui`; it does not create a nested
workspace merely to express project ownership. Project and component catalog
records become typed structural edits with compare-before-replace values taken
from the checked-in contracts.

## Plan contract

```yaml
schema_version: 1
project_id: example
template_id: monorepo-project
template_revision: 0123456789abcdef0123456789abcdef01234567
answers:
  project_id: example
  monitoring_token_ref: doppler://example/monitoring-token
owned_paths:
  - packages/example
shared_manifest_edits:
  - kind: mise_config_root
    value: packages/example
  - kind: pnpm_workspace_package
    value: packages/example
  - kind: repository_project
    value:
      id: example
      kind: library
      catalog_record: system:example/library
  - kind: catalog_record
    value:
      id: system:example/library
      kind: system
      project: project:example
      source_paths: [packages/example]
```

The template revision must be a full Git commit. The engine normalizes Copier's
receipt to that full SHA in `.copier/projects/<project>.yml` and requires it for
later updates. Never edit that file by hand.

Shared manifests use typed additions and record replacements. A replacement
must include the expected old record, so the engine stops if another change has
already altered it. The template itself cannot write a shared manifest.

## Execution boundary

The engine copies the current checkout, including staged, unstaged, and
untracked files, into a detached temporary worktree. It commits that snapshot,
runs Copier without template tasks or trust, applies the declared structural
edits, rejects conflict markers and `.rej` files, and runs the checks from the
trusted template registry. Checks must not modify the candidate patch.

Only the project answers file, declared owned paths, and shared manifests named
by typed edits may change. Before applying the patch, the engine verifies that
the caller checkout has not changed since planning began. Unrelated working
copy edits remain untouched.

Answer keys that look like passwords, tokens, credentials, private keys, API
keys, or secrets are rejected unless the key ends in `_ref` or `_reference`.
The reference is safe to record; the secret value is not.
