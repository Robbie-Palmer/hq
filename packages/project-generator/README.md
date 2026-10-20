# Project generator

This package runs Copier inside an existing monorepo without giving a template
ownership of the repository. It implements the engine selected by
[ADR 028](../../ui/content/projects/personal-engineering-platform/adrs/028-copier-monorepo-scaffolding.mdx).
The resolved-profile adapter and the first production template are separate
work.

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

The default template registry is
`ui/content/projects/personal-engineering-platform/project-template-sources.yaml`.
Plans select a template ID from that registry. They cannot provide a template
URL or executable command.

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
