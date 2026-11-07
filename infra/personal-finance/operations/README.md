# Personal Finance App operations

Copier generated this directory from `rollout.stateful_operations` in the
project profile. The hooks remain project-owned mise tasks. This directory
defines their order, authority checks, evidence format, and recovery boundary.
It contains no credential values.

## Activate the workflows

The repository owns the reusable workflow at
`.github/workflows/project-stateful-operations.yml`. Copy the applicable thin
callers from `operations/workflows/` into `.github/workflows/` in a reviewed
change. Keep each caller's generated environment name and redacted Doppler
reference unchanged. The Copier engine does not claim the shared workflow
directory on behalf of one project.

Create config-scoped GitHub secrets for the token names used by the callers.
Each token must resolve only the matching reference in
`generated-operations.yaml`. Record the provider audit or secret-manager item
ID in the project profile checkpoint. Never record a token value, database URL,
age identity, R2 secret key, or Access service credential.

`bootstrap-contract.json` is the redacted inventory for that handoff. The
project-owned `bootstrap:check:runtime` task checks only whether the declared
names are present in the current config. It never prints values. Keep
`PERSONAL_FINANCE_OPERATIONS_READY` unset until provider checks and the scoped
token handoff pass. Keep `PERSONAL_FINANCE_TERRAFORM_READY` unset until all six
checkpoints have audit evidence and the first Personal Finance plan has been
reviewed.

The generated dispatcher checks both `OPERATIONS_GITHUB_ENVIRONMENT` and
`OPERATIONS_SECRET_CONFIG_REF`. Mutation commands also require an exact
`OPERATIONS_MUTATION_TOKEN`. The reusable workflow derives that token only
after GitHub admits the job to its declared environment.

## Protected previews

`preview-up` runs these hooks in order:

1. Create resources named for the pull request, including a fresh Neon branch
   from the empty preview base.
2. Run the complete committed migration history.
3. Insert synthetic fixtures only.
4. Deploy the preview Worker and bind preview-scoped credentials.
5. Run the authenticated smoke hook through the protected preview hostname.
6. Prove that the smoke request emitted the expected OpenTelemetry and PostHog
   records.

The provision hook must refuse a production Neon project or branch ID. The
seed hook must refuse any fixture whose classification is not
`synthetic-only`. The smoke hook may use a synthetic test identity, but its
credential belongs only to the preview GitHub environment.

Closing the pull request runs `preview-cleanup`. The cleanup hook removes the
Worker preview, Neon branch, preview secrets, and any temporary route or Access
binding. It must be idempotent. A cleanup evidence file is incomplete if the
hook leaves a project resource bearing the pull-request name.

For a local dry check, inject no provider credentials and run the project hook
tasks individually. Do not set `OPERATIONS_MUTATION_TOKEN` during inspection.

## Production plan and apply

`production-plan` uses the read-only plan config. It runs `terraform init`,
writes a saved plan, records its SHA-256 digest, and encrypts it to
`operations/evidence/production.tfplan.age`. The workflow retains the encrypted
plan for three days and never uploads the plaintext plan. Set the public
`TERRAFORM_PLAN_AGE_RECIPIENT` in the plan config.

`production-apply` needs all of the following:

- the protected production GitHub environment;
- the apply-only Doppler config;
- the exact plan artifact from the preceding plan job; and
- the digest returned by that job.

The apply config holds `TERRAFORM_PLAN_AGE_IDENTITY`. The dispatcher writes it
to a mode-0600 temporary file, decrypts the artifact, checks the plaintext
digest, and applies that saved plan. It does not create a fresh plan with write
credentials. It removes the decrypted plan and identity file on exit. It then
runs migration, deploy, and production smoke hooks in that order. A failed
smoke check does not trigger an automatic rollback. Operators need the failure
evidence before choosing whether to roll the application back, restore data,
or fix forward.

`production-rollback <revision>` runs the project rollback hook, then repeats
the production smoke hook. The rollback hook may switch a Worker version or
artifact revision. It must not reverse a database migration unless a separate,
reviewed migration explicitly supports that direction. Keep forward-compatible
database changes deployed until the old and new application revisions no
longer need them.

## Backup and restore

The backup caller runs at `23 4 * * 0` UTC and can
also be dispatched by an operator. Its hook must use a direct Neon connection,
stream `pg_dump --format=custom` through age encryption, upload ciphertext and
its checksum to the project R2 bucket, and verify the uploaded object size.
R2 credentials must be bucket-scoped. CI receives the public age recipient,
not the private identity.

Keep the private age identity outside GitHub, Doppler, Neon, and Cloudflare.
Store two recovery copies under separate custody. Apply an R2 lifecycle policy
that retains the agreed weekly and monthly archives, plus an object-lock period
long enough to survive an accidental cleanup.

`restore <drill-id>` refuses targets unless `RESTORE_TARGET_CLASS=scratch`.
The restore hook must verify the ciphertext checksum, age authentication, and
PostgreSQL archive structure before it restores into a new scratch database.
Run migrations only when the drill explicitly tests upgrade recovery. Finish
with the same production smoke hook pointed at the scratch deployment, then
record the evidence object and destroy the drill resources in a separate
reviewed cleanup.

## Telemetry and alerts

The runtime hook owns OpenTelemetry instrumentation. It must emit the resource
identity recorded in the resolved blueprint, classify the deployment as
`preview` or `production`, and follow the default-deny data policy. Smoke
evidence should identify a trace or event by a generated correlation ID, never
by copying a user payload.

The named responder is `Personal Finance owner`. Terraform
owns alert definitions and thresholds. Destination attachment can remain a
manual PostHog checkpoint when the provider cannot represent it. Run
`alert-smoke` after creating an alert or changing its destination. The hook
must use a production-safe synthetic event, verify delivery, and leave the
alert enabled.

## Evidence and incident handoff

Every dispatcher command writes JSON that conforms to
`rollout-evidence.schema.json`. CI uploads the files even when a hook fails.
Evidence records action, revision, subject, timestamps, saved-plan digest, and
step outcomes. It does not capture command output or environment values.

Attach the evidence artifact URL to the delivery record or incident. Keep the
failed preview intact only when investigation needs it and the credentials
remain scoped. Otherwise run cleanup. For a production failure, preserve the
Terraform state and saved plan. Never finish an interrupted apply in a provider
console. Re-plan from the recorded revision after the state lock clears.
