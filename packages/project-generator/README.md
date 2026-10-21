# Project generator

This package runs Copier inside an existing monorepo without giving a template
ownership of the repository. It implements the engine selected by
[ADR 028](../../ui/content/projects/personal-engineering-platform/adrs/028-copier-monorepo-scaffolding.mdx).
The resolved-profile adapter compiles the current platform contracts into the
engine plan. The first production template remains separate work.

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
mise //:project:profile:dry-run -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:create -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
mise //:project:profile:update -- path/to/profile.yaml --effective-at 2026-10-21T00:00:00Z
```

These commands load the repository layout, platform manifest, Nix contract,
and OpenTelemetry contract from the Personal Engineering Platform project. The
explicit instant selects dated platform defaults. `--contracts`, `--registry`,
`--repository`, and `--template-id` replace their repository defaults when a
test or migration needs another input.

The default template registry is
`ui/content/projects/personal-engineering-platform/project-template-sources.yaml`.
Plans select a template ID from that registry. They cannot provide a template
URL or executable command. Profile commands also require the selected registry
entry to pin a full Git revision. Template revisions stay outside project
profiles.

The adapter records the complete resolved blueprint as a non-secret Copier
answer. Component paths become Copier-owned paths and mise configuration roots;
Node component paths also join the pnpm workspace. Project and component
catalog records become typed structural edits with compare-before-replace
values taken from the checked-in contracts.

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
