# PR preview environments

Internal pull requests receive a coordinated preview stack:

```text
https://pr-<number>.<pages-host>
  -> Pages Function auth proxy
  -> recipe-api-pr-<number> Worker
  -> recipe-ingest-pr-<number> Workflow Worker
  -> preview-pr-<number> Neon branch
  -> recipe-artifacts-preview R2 bucket (shared QA data only)
```

The Neon branch is an ordinary child of the empty `preview-base` root in a
dedicated preview project. That project has preview-only credentials and never
contains production rows, Better Auth sessions, OAuth tokens, or private
recipes. The workflow applies every committed migration to the empty branch and
then adds deterministic QA fixtures.

The database branch is deleted and recreated on every PR update so edited,
unmerged migration SQL is always exercised from zero. QA changes made in a
preview are disposable between pushes. The Workers and Workflow use the fresh
branch, and the cleanup workflow deletes them when the PR closes. Neon branch
expiry is a database-only backstop. The shared preview artifact bucket contains
only synthetic or QA data; a lifecycle rule expires objects after 30 days.

Fork pull requests do not receive preview infrastructure. The workflow uses
`pull_request` and explicitly gates every job to same-repository pull requests.
Only preview-scoped credentials are stored in the preview environment because
the deployed application code is still the PR's code.

For setup, recovery, credential rotation, and smoke tests, use the
[PR preview environment runbook](runbooks/preview-environments.md).

## Runtime safeguards

- Preview Workers use direct pooled Neon URLs and never receive the production
  Hyperdrive binding.
- OAuth providers are disabled in preview.
- Public email/password endpoints return `404`.
- The scenario login exists only when `DEPLOYMENT_ENV=preview`.
- Fresh QA sign-up exists only in previews, requires Access, and creates an
  isolated account so onboarding can be repeated without resetting fixtures.
- Scenario login requires a valid Access JWT and accepts only compiled-in IDs.
- The browser never receives the generated test password.
- Preview secrets are derived independently per PR and uploaded atomically with
  the Worker version.

## Adding QA scenarios

Add the scenario to
`workers/recipe-api/src/preview-scenarios.ts` and its deterministic domain data
to `workers/recipe-api/scripts/seed-preview.ts`. Seeds must be idempotent and
safe to retry within one workflow run. A new push replaces the database and any
manual QA changes in it.

## Neon Free plan constraints

The dedicated preview project uses one root branch, `preview-base`, and ordinary
child branches for PRs. Neon's current Free plan allows 10 branches per project,
so the project supports up to nine simultaneous PR databases when it contains
no other branches. This avoids the three-root-branch limit that constrained the
previous schema-only design to two concurrent previews.

Scale-to-zero is fixed at 5 minutes on the Free plan and cannot be configured.
Leave the Neon branch action's `suspend_timeout` input unset. The action then
forwards its default `0` sentinel so Neon uses the project's fixed setting;
positive overrides such as `300` are rejected with `412 Precondition Failed`.

## Database migrations

Schema changes use committed Drizzle migrations. Every preview branch starts
without application objects or migration history, so `drizzle-kit migrate`
applies the complete history beginning with the strict `0000_baseline.sql`.
The branch is recreated on every PR update because migration files can still be
edited before they reach `main`.

Once a migration reaches `main`, it is append-only. A missing table, column, or
constraint must fail deployment rather than being silently ignored.
