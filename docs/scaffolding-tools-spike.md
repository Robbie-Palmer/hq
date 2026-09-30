# Project and monorepo generation tools

Date: 2026-09-30. Work Graph ticket: `pep-scaffolding-tools-spike`.

Keep Backstage Software Templates as the declarative entry point. Use Copier for
new repositories and subsequent updates to template-owned files. Use a small
repository tool for adding components to existing mise workspaces and for
platform-specific semantic migrations. Adopt Nx generators when a workspace
already uses Nx or a concrete transformation needs its language tooling.
Cookiecutter offers no advantage over Copier for this platform's update needs.
These are spike recommendations, pending production implementation.

## Executed prototype

[The fixture](../tools/scaffolding-spike/README.md) runs a real Backstage catalog
and scaffolder backend with an in-memory SQLite database. It registers the
Template through `POST /api/catalog/locations`, reads the ingested entity, and
calls `POST /api/scaffolder/v2/dry-run`. The dry run renders files inside the task
workspace, without publishing a project or registering a Component.

`POST /api/scaffolder/v2/tasks` executes `pep:project:generate`, then
`pep:catalog:register`. The first action runs pinned Copier against a tagged Git
template. The second registers the repository-owned declaration through a URL.
A loopback HTTP server substitutes for repository hosting. The generated project
contains a platform profile, catalog entity, saved Copier answers, mise tasks,
pnpm workspace declaration, and Python project metadata.

The local run passed catalog registration, dry-run isolation, project creation,
Component ingestion, retries, rejected changed inputs and traversal, and the
tagged update conflict experiment. The backend has 100% line coverage in the
executed API fixture.

The verification script asserts that unchanged retries preserve files, changed
inputs fail instead of overwriting an existing project, and path traversal fails
validation. It commits a local edit, updates to a second template tag, and checks
that Copier preserves the edit in an explicit merge conflict. A successful
Copier exit alone is insufficient evidence of a successful migration.

The prototype does not publish to GitHub, build a Nix environment, resolve the
platform's dated defaults, or deploy a workload. Those belong to the bootstrap
implementation. The comparison of Nx and Cookiecutter below is based on their
documentation, not an executed benchmark.

## Comparison

| Requirement | Copier | Nx generators | Cookiecutter | Small repository tool |
| --- | --- | --- | --- | --- |
| Composition | Render a repository or a subdirectory; use explicit ownership to avoid overlapping templates | Compose generators over a virtual file tree | Nested templates and hooks; workflow composition needs another layer | Compose named operations and explicit owned paths |
| Recorded inputs | Answers file stores source, revision and non-secret answers | Schema validates options; persist a platform receipt separately | Replay JSON stores generation context | Store validated inputs and an operation receipt |
| Updates and conflicts | Template history supports updates and exposes conflicting edits | Versioned migration generators transform configuration; no general template three-way merge | Replay repeats generation; no equivalent template update merge | Implement preconditions and semantic edits; delegate template merging to Copier |
| Idempotency | Adapter must distinguish creation, retry and update | Generator must check existing configuration before modifying it | Regeneration needs destination handling | Compare operation identity, owned paths and recorded state |
| Multiple languages | File-oriented templates work across languages | Arbitrary files work; useful language automation depends on plugins | File-oriented templates work across languages | Parse each supported manifest using its format library |
| Tests | Generate fixtures and exercise tagged updates with local edits | Virtual-tree tests can inspect changes before writing | Generate fixtures and test hooks | Test real fixture transformations, retries and rejected preconditions |
| Hooks | Tasks and migrations can execute code; require deliberate trust | Generator callbacks can execute code | Pre/post-generation hooks can execute code | Avoid arbitrary commands; expose allowlisted operations |
| Secret safety | Exclude secrets from answers and generated files | Keep secrets outside option receipts and logs | Replay context needs careful exclusions | Accept secret references, never values, in persisted inputs |
| mise | Generate configuration; invoke tasks through mise | Keep mise as the task interface if using Nx for transformations | Generate configuration | Update config roots and task declarations structurally |
| pnpm | Generate workspace and package declarations | Strong fit for JS/TS workspaces; task execution is optional for generation | Generate declarations | Update workspace membership and package manifests |
| uv | Generate Python metadata and workspace membership | File support exists; Python tooling needs plugins or custom code | Generate Python metadata | Update Python manifests using TOML parsing |
| Nix | Render flake definitions; locking and evaluation remain separate tasks | Generate files; explicit Nix integration needed | Render definitions; explicit locking needed | Update declared inputs; run Nix checks through mise |

The table judges duplication and missing automation. Running Backstage as a
service is acceptable. Its catalog registration, parameter schemas, action
composition and task tracking are useful platform responsibilities.

Copier's saved revision and update merge are the decisive advantages for
repository-wide defaults. Its answers file must remain generator-owned.
[Copier's update documentation](https://copier.readthedocs.io/en/stable/updating/)
describes clean Git destinations, tagged templates and conflict handling.
[Its template configuration](https://copier.readthedocs.io/en/stable/configuring/)
covers tasks, migrations and secret questions.

Nx is useful when a change requires structured edits across related components.
[Local generators](https://nx.dev/docs/kb/local-generators) and
[migration generators](https://nx.dev/docs/kb/migration-generators) provide an
existing transformation framework. Introducing Nx solely to edit mise, pnpm
and uv metadata would add another workspace configuration to maintain. Revisit
that choice if the repository tool grows into a general generator framework.

Cookiecutter's [replay mechanism](https://cookiecutter.readthedocs.io/en/stable/advanced/replay.html)
reuses inputs. Its [hooks](https://cookiecutter.readthedocs.io/en/stable/advanced/hooks.html)
can customise generation. Neither supplies the update merge this platform needs.

## Backstage-to-generator contract

A versioned Template owns the user-facing input schema and sequence of named
actions. It passes a validated request to a versioned generator adapter. The
adapter owns execution, receipts and repeat behavior. Repository declarations
remain authoritative; Backstage derives its catalog records from them.
[Template registration](https://backstage.io/docs/features/software-templates/adding-templates/)
and [custom actions](https://backstage.io/docs/features/software-templates/writing-custom-actions/)
provide those extension points.

The production request must contain:

* A contract version and operation, such as `create`, `add-component` or `migrate`.
* A request identity tied to the destination and a hash of canonical inputs.
* A repository or workspace target selected from allowed destinations.
* A profile with layers, capabilities, environments, deployment stage, artifact
  classes and overrides, plus an effective date and immutable resolved defaults.
* An allowlisted template identity and immutable source revision.
* Component identity and relative path for component additions.
* Current and target policy revisions for migrations.
* Secret references whose values are resolved only by provisioning actions.

No caller-supplied executable, shell command, template URL or absolute output
path may enter the engine invocation. The fixture demonstrates a restricted
subset with a fixed template tag and name/owner schema. The remaining fields
need the profile and reconciliation tickets before production adoption.

The response must include owned paths, rendered changes or a diff, profile and
catalog declaration paths, engine version, template revision, input hash,
operation receipt, conflicts and required checks. A dry run may write to a
disposable workspace so agents can inspect the exact files. It must skip
publishing, external registration, provisioning and secret writes.
[Backstage dry-run handling](https://backstage.io/docs/features/software-templates/dry-run-testing/)
requires actions to declare support and handle that behavior explicitly.

Unchanged retries return the original receipt and preserve product edits.
Changed inputs require an explicit update or migration. Creation must reserve
the destination atomically before publication. Backstage task checkpoints
handle recovery inside a task; persistent receipts handle repeated requests
across tasks. The fixture tests sequential retries only. Concurrent retries
and crash recovery remain production work.

Copier updates run on a clean branch or disposable worktree. Scan for inline
conflict markers and rejection files even when the process exits successfully.
Publish a migration PR only after conflicts are resolved and mise checks pass.
Never edit saved Copier answers to make a migration appear complete.

## Engine per job

| Job | Selected execution engine | Boundary |
| --- | --- | --- |
| Create a repository | Copier, invoked by a Backstage action | One tagged base template owns shared files; the resolved profile selects content |
| Add a component | Small repository tool, invoked by a Backstage action | Validate names and paths; create files; structurally update mise, pnpm or uv membership |
| Update template-owned defaults | Copier update | Review the diff and fail checks on unresolved conflicts |
| Migrate platform or component configuration | Small repository tool | Versioned transformations with old-state preconditions and receipts |
| Nx-specific workspace transformation | Nx generator or migration generator | Use the workspace's existing Nx tooling behind the same action contract |
| Publish and register | Backstage actions | Publish repository declarations, then register their canonical URL |

One base Copier template should own cross-cutting repository files. Component
operations may own separate paths but must not independently regenerate shared
manifests. This prevents a base update from undoing a later component addition.
For existing repositories, adoption should first record ownership and produce a
diff. It must not force-copy a base template over product code.

The next implementation should add the production profile schema and resolver,
atomic publication, receipt storage and permission checks. Keep the fixture as
an API integration test when replacing the local hosting substitute with the
repository publisher. Add Nix evaluation and generated project checks once the
reproducible environment template exists.
