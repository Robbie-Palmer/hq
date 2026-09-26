# Stateful AI review

This top-level project is the deployable service proposed by
[ADR 056](../ui/content/projects/personal-knowledge-graph/adrs/056-stateful-ai-code-review.mdx).
The ADR remains in the Personal Knowledge Graph content tree for now, but the
service is not a Personal Knowledge Graph runtime component.

The service is a visible, stateful publisher. A Worker verifies GitHub App
webhook signatures and rejects other repositories. One SQLite Durable Object
per pull request deduplicates deliveries and already-reviewed heads, assigns
durable hunk and finding identities, enforces per-PR run and cost ceilings,
and uses its alarm both as a trailing-edge debounce (rapid events coalesce to
one review of the latest state) and as the retry path for delayed finding
evaluation and unpublished outcomes. A Cloudflare Workflow fetches the PR
through GitHub App authentication, runs the shared OpenRouter and OpenCode
scout ensemble, reconciles candidates with the same OpenRouter merger,
publishes each line-addressable finding as a native review comment with a
stable hidden finding ID, and keeps a separate rolling run/cost/coverage
comment. Scouts run as separate Workflow steps, so a stalled free provider
cannot replay completed paid calls, while deterministic publication and
storage steps remain retryable. The private `ai-review-data` R2 bucket stores versioned terminal
records for published, skipped, denied, and failed runs, including raw
candidates, provider cost, latency, token, cache, availability, and failure
metrics. We retired the former stateless GitHub Actions orchestrator and Node
entry point. Their prompts, model clients, validation, and rendering code now
live in `ai-review-domain`, which this service and the replay tooling import
directly.

Automatic runs cover non-draft PR opens, ready-for-review transitions, reopens,
and synchronized heads. After the first completed review, synchronized heads
send only new or materially changed hunks, bounded context for their files, and
unchanged hunks tied to affected open findings. Generated files, lockfiles, and
whitespace-only hunks are skipped. Authentication, secrets, database-schema,
infrastructure, and deployment changes escalate deterministically to full
coverage. The rolling comment always labels coverage as full, incremental, or
skipped.

An exact `/ai-review` or `/ai-review full` issue comment from an owner, member,
or collaborator forces a full review of the current head, including on a draft.
If that same head is subsequently merged, its latest successful full review is
the final pre-merge review retrospectively; any later commit requires another
full review.
Ordinary comments and review-thread activity never schedule paid work. Replies,
reaction-count snapshots, thread resolution, and trusted
`/ai-review acknowledge f_<id> <reason>` or
`/ai-review reject f_<id> <reason>` commands instead take a storage-only path.
On an attached finding thread, trusted reviewers record a disposition by
replying with `/ai-review acknowledge <reason>`, `/ai-review confirm-fixed
<reason>`, or `/ai-review reject <reason>` before resolving it. Thread context
binds the command to the hidden finding ID. `confirm-fixed` is accepted only
after a controlled replay returns `fixed` for the current head. Findings that
GitHub cannot attach to a current diff line remain in the rolling comment with
the finding-ID form of those commands as a top-level fallback only; do not use
the finding-ID form inside an attached thread. Editing an exact disposition
reply records a new immutable outcome revision; deleting the GitHub comment
does not erase an already-recorded analytical outcome.

OpenRouter is the default paid inference gateway because its broader model and
provider catalogue, provider failover, model fallbacks, and price/performance
routing are useful properties of the architecture itself. The current route
runs the paid scout ensemble through OpenRouter, eligible live free models
through OpenCode Zen, and Gemini 3.7 Flash as the price-capped OpenRouter
merger. Workers AI is deliberately not
bound or used: its narrower catalogue and provider-specific integration do not
justify higher published prices than the current multi-provider route.

## Ownership boundaries

- `ai-review/wrangler.toml` owns the Worker, Durable Object, Workflow, bindings,
  and non-secret runtime configuration.
- Changed-file context is fetched through bounded GitHub GraphQL batches rather
  than one REST request per path. This keeps large reviews below Cloudflare's
  subrequest ceiling without changing the shared prompt or coverage budgets.
- `infra/public-platform/` owns the shared Cloudflare account's private R2 bucket.
- R2 expires review records after 365 days and aborts incomplete multipart
  uploads after seven days. Cloudflare provider v4 cannot represent those
  rules, so they are configured once with Wrangler and verified during setup.
- Doppler project `ai-review`, config `prd`, owns deploy and runtime secrets.
- Doppler config `ai-review/stg` mirrors those credentials for the isolated
  `ai-review-staging` Worker used only for explicit end-to-end QA.
- GitHub environment `production-ai-review` is a generated deployment mirror
  of `ai-review/prd`.
- The private
  [`robbie-palmer-ai-review`](https://github.com/apps/robbie-palmer-ai-review)
  GitHub App is installed only on `Robbie-Palmer/hq`.

## Required Doppler values

Masked values:

- `CLOUDFLARE_API_TOKEN`
- `AI_REVIEW_APP_PRIVATE_KEY`
- `AI_REVIEW_WEBHOOK_SECRET`
- `OPENROUTER_API_KEY`

Unmasked values:

- `CLOUDFLARE_ACCOUNT_ID`
- `AI_REVIEW_APP_ID`
- `AI_REVIEW_APP_INSTALLATION_ID`

GitHub Actions reserves the `GITHUB_` prefix, so App credentials use the
`AI_REVIEW_` prefix in Doppler and the Worker.
`AI_REVIEW_APP_PRIVATE_KEY` must be the unencrypted PKCS#8 representation of
the GitHub-generated PKCS#1 key. Convert it once before storage with
`openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt`; runtime authentication
is delegated to `@octokit/auth-app` and does not parse or rewrite private-key
formats.
The spend-limited OpenRouter key is installed as a Worker runtime secret.
`OPENCODE_API_KEY` is optional while OpenCode Zen permits anonymous free-model
requests; if present in Doppler it is installed as a runtime secret too.
The committed `ai-review-data` name is authoritative in Terraform, Wrangler,
and lifecycle verification; it is not a deployment input.
`AI_REVIEW_DATA_RETENTION_DAYS` documents the intended bucket policy only. The
Worker neither treats object metadata as enforcement nor deletes records; the
bucket-level lifecycle rule above is authoritative.

## GitHub App and review policy

The App requires repository metadata and contents read access, **pull-request
read/write access** for native review comments, and issues read/write access for
its rolling comment and command fallback. Subscribe it to `pull_request`,
`issue_comment`, `pull_request_review_comment`, and
`pull_request_review_thread` events. Changes to the existing App are made in
its GitHub settings and require the installation owner to approve the expanded
pull-request permission. The Worker verifies every signature and re-checks the
repository, PR state, draft state, author, exact command text,
command-author association, feedback actor, and current head before accepting
an event, spending, or publishing.

Committed non-secret defaults in `wrangler.toml` configure the shared reviewer:

- `AI_REVIEW_MODELS`, `AI_REVIEW_OPENCODE_MODELS`, and
  `AI_REVIEW_MERGER_MODEL` select the current ensemble;
- `AI_REVIEW_ZDR` applies the OpenRouter routing constraint;
- `AI_REVIEW_MAX_PR_COST_USD=5` stops new runs after recorded successful or
  failed stateful runs on the PR reach that cumulative cost;
- `AI_REVIEW_MAX_RUNS_PER_PR=20` caps attempted stateful runs per PR;
- `AI_REVIEW_PUBLICATION_POLICY_VERSION=deterministic-publication-v1` and
  `AI_REVIEW_MAX_VISIBLE_FINDINGS=7` identify the publication rules and cap
  visible open findings. The Worker keeps every accepted scout candidate and
  records merged findings withheld by the cap or speculative language filter
  in R2;
- `AI_REVIEW_RELIABILITY_POLICY_VERSION=consecutive-failures-v1`,
  `AI_REVIEW_MODEL_FAILURE_THRESHOLD=3`, and
  `AI_REVIEW_MODEL_COOLDOWN_SECONDS=3600` identify the model health rules. A
  singleton Durable Object stores idempotent success and failure observations,
  pauses a model after three consecutive failures, and tries it again after a
  one-hour cooldown without deleting its failure history;
- `AI_REVIEW_OUTCOME_WINDOW_SECONDS=604800` waits seven days before labeling
  a silent finding `no-observable-response`, while
  `AI_REVIEW_OUTCOME_EVALUATOR_VERSION` identifies the decision rules stored
  with each evaluation; and
- `AI_REVIEW_PROMPT_VERSION` participates in the durable idempotency key, so an
  intentional prompt/configuration change can review an unchanged head once.

The rolling comment states that the review is advisory. It also reports
incomplete coverage when a scout or merger is in cooldown. An explicit
`/ai-review` run includes both active policy versions and their limits in the
comment.

The per-PR Durable Object permits only one paid review to be in flight. This
ensures a later head cannot bypass the cost ceiling while an earlier review's
spend is still unknown. A running claim expires after 30 minutes so a Workflow
terminated outside application code cannot block that pull request forever.
Before admitting a replacement, the coordinator terminates the expired
Cloudflare Workflow and waits for that operation to succeed. Paid OpenRouter
completion requests also make exactly one HTTP attempt because the provider
does not expose an idempotency key; GitHub and free-provider requests retain
their bounded transient retries.

### Review data schema

New analytical records use schema version 2 under
`v2/<owner>/<repository>/pr-<number>/<head>/<workflow>/<status>.json`. The
status is `published`, `skipped`, `denied`, or `failed`; using a distinct object
per terminal status preserves a published record if a later deterministic
completion step fails. Existing schema-version-1 objects remain readable and
are not rewritten.

PR-scoped hunk IDs hash the repository path and normalized unified-diff body while
excluding hunk coordinates, so an unchanged hunk keeps its identity when lines
move. PR-scoped finding IDs hash the path and normalized finding title, excluding line,
severity, status, and model provenance. The Durable Object upserts these
identities into `review_hunks`, `review_findings`, and
`review_finding_hunks`; first-seen values remain immutable while last-seen
values advance with later completed runs. `review_run_hunks` records both the
current-head hunk set and which subset was sent for review, allowing the next
run to compare against the last completed head. R2 retains the trigger decision,
full coverage accounting, raw per-model candidates, and the merged findings
that were actually published.

Native review-comment mappings live in `review_finding_comments`, so later
heads reconcile the same finding instead of publishing another thread.
Accepted feedback deliveries are deduplicated by GitHub delivery ID and stored
in `review_finding_events`. Each is also appended as schema-v2 evidence at
`v2/<owner>/<repository>/pr-<number>/findings/<finding-id>/evidence/<delivery>.json`.
These records preserve the event/action, trusted actor, reply or command body,
reaction counts present on review-comment events, thread state, explicit
disposition and timestamps without mutating earlier evidence.

`review_finding_evaluations` records each deterministic evaluation attempt,
including incomplete and manual-adjudication-required decisions.
`review_finding_outcomes` stores the resulting versioned labels. Each outcome
records confidence, evaluator version, whether it is adjudicated, censored, or
a workflow observation, and any trusted manual override. An explicit
acknowledgement or rejection creates an outcome immediately.
When a later review covers the finding's file after its affected hunks change,
the merger performs a controlled replay of the durable finding against the
current diff and file context, recording `fixed`, `still-present`, or `uncertain`
with direct code evidence. Replay supplies evidence. The coordinator
adds a `confirmed-fixed` outcome only after a trusted actor submits
the top-level fallback `/ai-review confirm-fixed <finding-id> <reason>` for a
recorded `fixed` replay when no finding thread is available.
The coordinator fetches the authoritative current PR head from GitHub when it
handles the trusted command. A completed forced full review can
carry a fixed verdict forward when it produced no newer resolution for that
finding, because the finding's file had no new semantic hunks. The outcome
records that current-head validation run alongside the original replay. PR
content, model omission, or a resolved GitHub thread cannot mint a confirmed
label by itself. Confirmation suppresses replay only on that exact head; a
later head makes the finding eligible for replay again.

On `pull_request.closed`, the evaluator immediately joins each finding to the
final reviewed head, later resolution evidence, replies, reaction snapshots,
and thread state. A finding becomes `superseded` when the final reviewed diff no
longer contains its affected hunks. Incomplete findings are reevaluated after
`AI_REVIEW_OUTCOME_WINDOW_SECONDS`, which defaults to seven days. A finding
with no human or code response then becomes `no-observable-response`; the
record marks it as a workflow observation and not a correctness judgment.
Conflicting replies, reactions, thread state, or fixed replay evidence enter
manual adjudication instead of going to a model. A later trusted disposition
appends a manual override and automatic evaluation will not replace it. A
legacy finding with a persisted explicit disposition but no outcome row
receives the matching `acknowledged` or `rejected` label.

Outcome revisions are immutable schema-v2 objects at
`v2/<owner>/<repository>/pr-<number>/findings/<finding-id>/outcomes/v<version>.json`.
The highest version is the current outcome; earlier labels remain available to
show how later evidence or a manual override changed the attribution. SQLite
commits the outcome before R2 publication and retains an `r2_recorded` flag, so
a replayed webhook, evaluator alarm, or review completion repairs an interrupted
object write without creating another revision.

### Scorecard marts

The DuckDB batch in `analytics/` builds versioned `finding_latest`,
`review_run_fact`, `model_run_fact`, and `pull_request_fact` Parquet marts plus
a checksum-bearing machine-readable manifest. It reads schema-v1 and schema-v2
records without rewriting historical objects: schema v1 (which predates record
types and durable finding identities) contributes spend, token, call, and
published-finding counts, while outcome-derived metrics remain available only
where durable identities exist. The latest outcome is the highest
`outcomeVersion`; `finding_history` remains in the transient DuckDB build so
revision resolution is explicit and testable. Unknown schema versions, unknown
record types, duplicate revisions, and outcome/evidence joins to unpublished
findings stop the build. When one workflow has both `published` and `failed`
terminal records, the published record is authoritative; every other duplicate
or conflicting terminal combination stops the build. Pull Request-grain marts
retain distinct prompt versions, task types, and originating agents as lists so
a multi-run lifecycle is not attributed to one arbitrary scalar value.

Pull the versioned records from the `ai-review-data` R2 bucket (loads
credentials from Doppler) and build from them:

```bash
mise run //ai-review:scorecard:pull
mise run //ai-review:scorecard:build
mise run //ai-review:scorecard:baseline
mise run //ai-review:scorecard:report -- --baseline ~/.cache/ai-review/baseline/stateless-baseline.json
```

`pull` caches the bucket under `~/.cache/ai-review/r2-export` (idempotent:
objects already present at their listed size are skipped). With no
arguments, `build` reads that cache and writes marts to
`~/.cache/ai-review/marts`, and `report` reads the built marts and writes
`scorecard-report.json` / `.md` to `~/.cache/ai-review/report`. Explicit
paths override the defaults (`mise run //ai-review:scorecard:build --
/path/to/r2-export /path/to/output`, `report --marts ... --output ...`);
paths are resolved relative to `ai-review/` when run through mise. The
cache root can be redirected with `AI_REVIEW_SCORECARD_CACHE`. Building
from any other fixed export prefix stays fully deterministic and
offline.

`scorecard:baseline` selects schema-v1 review runs from the marts and writes
`~/.cache/ai-review/baseline/stateless-baseline.json`. The artifact records its
source mart checksums, sample sizes, efficiency values, and a content-derived
baseline ID. Pass it to the report with `--baseline` to compare schema-v2
stateful review against the same stateless evidence instead of entering
baseline values by hand.

Metric definitions follow
[Agentic Code Review ADR 033](/projects/agentic-code-review/adrs/033-duckdb-ai-review-scorecard):
acceptance excludes censored outcomes, fix-through and noise use published
findings as their denominator, cost uses accepted findings, token efficiency
uses uncached input tokens, and coverage uses reviewed over total hunks. Outputs
retain prompt, risk, change-size, repository-area, task, originating-agent, and
time dimensions for stratification.

### Scorecard report and controlled replay CLI

The report CLI turns a built marts release into versioned JSON and Markdown
suitable for ADR evidence, without a dashboard:

```bash
mise run //ai-review:scorecard:build   # produce marts first
mise run //ai-review:scorecard:report -- --marts /path/to/output/v1 --output /path/to/report
```

Reports expose sample sizes (runs, PRs, model calls, published and adjudicated
findings), censored outcomes (`superseded`, still-incomplete outcomes, and
legacy findings without durable identity), and every ADR metric including
review efficiency and time to useful finding. The `time to useful finding`
metric is measured from the PR's first recorded review trigger because PR-ready
timestamps are not recorded. Slices are selected with `--slices` over model,
prompt, repository area, risk, change size, task type, and originating agent;
dimensions absent from a record are reported as `(unknown)` rather than
estimated. Model comparisons are grouped by role, prompt version, and
publication policy version, so the merger is reported separately from scouts
(source-model attribution credits scouts only) and incompatible configurations
are never mixed; aggregating a model across them requires an explicit
`--allow-mixed-compatibility`, and
`--min-sample-size` suppresses values whose denominator is below the fixed
threshold while keeping the sample size visible. `--baseline` accepts a JSON
file with the stateless GitHub Actions baseline for review-efficiency ratios.
Rebuilding the same marts produces byte-identical reports.

The replay CLI plans or executes a controlled replay from a frozen
`replay-manifest` record:

```bash
mise run //ai-review:scorecard:replay -- --manifest /path/to/replays/frozen-set-1.json --output /path/to/plan
mise run //ai-review:scorecard:replay -- --manifest /path/to/replays/frozen-set-1.json --output /path/to/result \
  --yes --max-cost-usd 5 --models model-a,model-b --executor "/path/to/review-executor"
```

Without `--yes` the CLI only validates the manifest and writes a
`replay-plan.json`; nothing is executed and no executor is invoked.
Execution requires `--yes`, a positive `--max-cost-usd` cap, a fixed model set,
and an executor command that receives each frozen PR (repository, PR number,
head SHA, prompt version, models, remaining budget) as JSON on stdin and emits
one JSON object with a finite non-negative `costUsd` on stdout; output
without a valid `costUsd` fails the replay. The executor is responsible for
honouring the remaining budget it receives; the CLI never starts an execution
without budget left, records each skipped PR in
`controlled-replay-result.json`, and exits non-zero when the executor fails,
exceeds the five-minute executor timeout, or reports a cost that breaches the
cap.
Replay outputs are versioned records; the CLI never rewrites the historical
objects it reads.

The corpus replay runner in `src/replay-runner.ts` executes one frozen
`ai-review-replay-input` entry through the production scout, merger, validation,
and finding-identification boundaries. Its adapter has no publication method,
and isolated model calls neither read nor update the per-PR Durable Object.
Call `runControlledReplay` with a corpus store, a production adapter, and one
declared experiment: scout models, merger model, prompt version, or coverage
policy. The store writes results below
`replays/v1/<corpus-id>/<configuration-id>/repetition-<n>.json`, separate from
production review records.

The production service and evaluation pipeline import their shared Zod schemas
and inferred TypeScript types from `packages/ai-review-domain`. This keeps replay
inputs, finding outcomes, coverage, change profiles, model metrics, provider
names, and experiment contracts identical on both sides of the boundary.

Production R2 paths are built in `src/r2-keys.ts`. The scorecard fixtures mirror
those paths, and `tests/r2-keys.test.ts` pins the layout so a path change fails
before the analytics job stops ingesting new records.

Every request must declare model-count, token, cost, provider, privacy,
timeout, and repetition limits. The default is a dry-run plan, which validates
the frozen input and reports the full production-to-experiment difference
without calling a model. Execution requires `dryRun: false`. Repeating the same
corpus and configuration returns the stored result; set a new repetition index
to run it again. The result retains raw candidates, merged findings, failures,
usage, latency, cost, applied configuration, and corpus provenance.

Run one locally cached production snapshot with the corpus CLI. Omit `--execute`
for the dry plan, then load production provider credentials only for the explicit
execution:

```bash
mise //ai-review:corpus:replay -- \
  --snapshot <input-v1.json> \
  --corpus-id <snapshot-sha256> \
  --output ~/.cache/ai-review/corpus-replays \
  --provider openrouter \
  --model <experimental-model> \
  --max-cost-usd 0.25

doppler run --project ai-review --config prd -- \
  mise //ai-review:corpus:replay -- \
  --snapshot <input-v1.json> \
  --corpus-id <snapshot-sha256> \
  --output ~/.cache/ai-review/corpus-replays \
  --provider openrouter \
  --model <experimental-model> \
  --max-cost-usd 0.25 \
  --execute
```

Evaluation pipelines can pass any supported single-variable experiment as a
JSON file with `--experiment`: scout models, merger model, prompt version, or
coverage policy. `--max-models`, `--max-scout-tokens`, `--max-merger-tokens`,
`--max-repetitions`, `--allowed-providers`, and
`--require-zero-data-retention` keep the whole repeated experiment on one fixed
limit set. The older `--model` and `--provider` form remains available for a
single scout-model replay.

The local store claims the result key atomically and writes the same
`replays/v1` namespace used by the runner. The command prints the plan or result
as one JSON object. It never calls a GitHub publication API.

## Deploy

Sync the environment after changing Doppler:

```bash
scripts/sync-doppler-github-envs.sh production-ai-review
```

For a local deployment:

```bash
mise run //ai-review:deploy
```

For an isolated staging deployment and live review of the current branch's PR:

```bash
mise run //ai-review:deploy:staging
mise run //ai-review:e2e:staging
```

Staging deploys as `ai-review-staging`, uses its own Durable Object namespace,
Workflow, and private `ai-review-data-staging` bucket, and publishes through the
real GitHub App. The E2E task sends a correctly signed synthetic `/ai-review`
webhook, waits for its versioned R2 record, and verifies that the visible
stateful PR comment targets the current head and that at least one scout
provided actual review coverage.
Set `AI_REVIEW_E2E_PULL_REQUEST` to test another pull request explicitly.
After a full staging run establishes a baseline, add a semantic commit that
preserves at least one eligible baseline hunk, then set
`AI_REVIEW_E2E_EVENT_MODE=synchronize` to send a non-forced `pull_request`
event and require incremental coverage with both reviewed and unchanged hunks.

The deploy task loads `ai-review/prd` when required values are not already in
the environment. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` authenticate
Wrangler for deployment; they are not installed as Worker runtime secrets. The
mode-`0600` Wrangler secrets file contains `AI_REVIEW_APP_ID`,
`AI_REVIEW_APP_INSTALLATION_ID`, `AI_REVIEW_APP_PRIVATE_KEY`,
`AI_REVIEW_WEBHOOK_SECRET`, and `OPENROUTER_API_KEY`, plus
`OPENCODE_API_KEY` when configured, inside a mode-`0700` temporary directory.
The cleanup trap unlinks the file after Wrangler exits or the deploy is
interrupted. Linux deployments, including GitHub-hosted runners, place that
directory on `/dev/shm` when it is available and writable, so even an
untrappable process termination leaves secrets only in the runner's
memory-backed temporary filesystem. Other environments fall back to
`${TMPDIR:-/tmp}` and retain only the unlink-on-exit protection.
The GitHub App webhook URL is:

```text
https://ai-review.robbiepalmer95.workers.dev/webhooks/github
```

Verify the out-of-band R2 retention rule without reading any objects:

```bash
doppler run --project ai-review --config prd -- \
  mise run //ai-review:lifecycle:verify
```

Production deployment runs the same verification and fails if the 365-day
expiry or seven-day multipart-abort policy drifts.

## Validation

```bash
mise run //ai-review:check
mise run //ai-review:deploy:dry-run
mise run //infra/public-platform:format:check
mise run //infra/public-platform:precommit-lint
mise run //:lint:actions
```

Deterministic unit tests use thin `cloudflare:workers` class stubs to exercise
routing, GitHub authentication, exact model parity, publication, and analytics
without paid calls. A separate Cloudflare-supported Vitest pool runs Durable
Object delivery, alarm, eviction, SQLite, claim, completion, and deduplication
tests inside `workerd`. Type checking against the current Workers types and the
Wrangler deployment dry-run validate the bundled runtime surface.
The `/health` response is intentionally a non-mutating binding-presence check;
the deployment dry-run is the functional binding-configuration check.
