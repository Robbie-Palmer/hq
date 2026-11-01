# Agent Coordinator `hq` delivery contract

This delivery contract governs the first Agent Coordinator pilot. It covers
dependency vulnerability fixes in `Robbie-Palmer/hq` whose production effect is
the personal-site UI deployed by [UI CD](../../.github/workflows/ui-cd.yml).
The production target is the Cloudflare Pages project `personal-site`, production
branch `main`, served at `https://robbiepalmer.me`.

An incident is outside this pilot if its fix changes a different deployed
service, requires a data migration, or cannot be validated through the UI CD
path and the incident-specific smoke test. Request attention instead of applying
this contract to another target.

## Delivery gates

### Local checks

Run these commands from a clean worktree before publishing or updating the pull
request:

```bash
mise //ui:check
NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH=placeholder mise //ui:build
mise //ui:delivery:test
mise //ui:delivery:test:coverage
mise //:lint:actions
mise //:lint:markdown:check -- AGENTS.md docs/runbooks/agent-coordinator-hq-delivery.md
```

Also run the owning package's `mise //<project>:check` task when the fix changes
a workspace package consumed by the UI. Record every command and result in the
pull request. Do not replace a failed check with an exclusion, generated-file
edit, or weaker command.

### Branch and review policy

The active `main` ruleset requires a pull request, blocks deletion and
non-fast-forward updates, allows only squash merges, and requires zero approving
reviews. Repository settings disable merge commits and rebase merges. The
personal-project policy permits an agent to merge without routine
human approval, but only after all triggered checks finish successfully and all
actionable review findings are resolved.

Read the live rules before each merge:

```bash
gh api repos/Robbie-Palmer/hq/rulesets
gh api repos/Robbie-Palmer/hq/rulesets/9014555
gh repo view Robbie-Palmer/hq \
  --json defaultBranchRef,mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed
```

Live policy wins if it becomes stricter. Stop and request attention if the
ruleset ID changes, the rules conflict, a required check cannot run, or the
agent lacks merge authority. Never use an administrator bypass, change the
ruleset, dismiss a review, or mark a check successful.

Use the repository's review loop until the head revision is stable. Then merge
with the only allowed method:

```bash
gh pr merge <pr-number> --repo Robbie-Palmer/hq --squash --delete-branch
```

Read the pull request again and record its `mergeCommit.oid` as
`<merged-revision>`. Do not infer the merged revision from the former branch
head.

## Deployment and production proof

A push to `main` that matches the path filters in UI CD builds and deploys the
site. If GitHub does not create that run for the merged revision, dispatch the
same checked-in workflow on `main`:

```bash
gh workflow run ui-cd.yml --repo Robbie-Palmer/hq --ref main
```

Do not deploy a local checkout or a pull-request branch to production. Subscribe
to the workflow through the agent runtime, then inspect the terminal run. The
run must have `headSha == <merged-revision>`, event `push` or an explicitly
recorded `workflow_dispatch`, and conclusion `success`. A superseded or cancelled
run is not evidence.

UI CD runs `mise //ui:smoke:production` after the Pages upload. The smoke test
uses unauthenticated `GET` requests only. It checks the HTML home page,
`/llms.txt`, and `/projects/agent-coordinator.md` on the fixed production origin.
The incident owner must add and run one vulnerability-specific production check
when the generic probes do not exercise the affected dependency. State that
check in the pull request before merge so its expected result is reviewable.

Success requires this evidence:

1. The pull request is squash-merged and identifies `<merged-revision>`.
2. UI CD succeeds with that exact revision and deploys the `main` branch to the
   `personal-site` Pages project.
3. The generic production smoke test and the incident-specific check pass after
   that deployment.
4. The Dependabot alert is closed by GitHub, or GitHub still reports it open for
   a documented propagation delay. Never dismiss it as a substitute for a fix.

Record the PR URL, merged revision, UI CD run URL, production target, smoke
results, alert state, and UTC timestamps in the incident's durable Work Graph
note. Release a Work Graph ticket only after the merged and deployed evidence
exists.

## Failed rollout and rollback

Prefer a bounded repair when the cause is clear, the site remains usable, and
the repair can pass the same gates promptly. Otherwise contain the rollout with
the [UI production rollback](../../.github/workflows/ui-production-rollback.yml)
workflow. Choose the most recent UI CD revision that passed production
validation before the failed revision:

```bash
gh workflow run ui-production-rollback.yml \
  --repo Robbie-Palmer/hq \
  --ref main \
  -f failed_revision=<failed-40-character-revision> \
  -f target_revision=<known-good-40-character-revision> \
  -f incident=<work-graph-ticket-or-pr-url>
```

The workflow refuses to roll back if production no longer serves the failed
revision, if the target is not a successful production deployment from `main`,
or if either revision is malformed. It uses the Cloudflare Pages rollback API,
reruns the production smoke test, and records both outcomes in the workflow
summary. These guards prevent a delayed incident from replacing a newer
deployment.

A Pages rollback contains the incident but does not change `main`. Make the
source state durable immediately. Start from current `origin/main`, revert the
failed squash commit with `git revert <merged-revision>`, and open a pull request.
Run the same local checks, review loop, squash merge, deployment proof, and
production validation on that revert. Do not force-push `main` or delete a
migration to simulate a rollback.

Record the rollback run URL, selected target revision, smoke result, source
revert PR, and remaining risk in a Work Graph note. A failed rollback smoke test
is still an active incident. Try no second target unless the evidence makes the
choice unambiguous.

## Authority and attention

For this personal-project pilot, an admitted worker may edit code, push its
branch, open and update a pull request, respond to review, squash-merge after the
gates pass, let UI CD deploy, inspect public production responses, invoke the
guarded rollback workflow, and revert its own merged change.

It may not bypass branch protection, alter required checks or environment
protections, expose or rotate credentials, dismiss the alert, deploy another
service under this contract, perform destructive data work, or choose among
ambiguous rollback targets. It also may not call a failed rollout healthy merely
because the Pages upload completed.

Missing access, a policy conflict, an unsafe fix, an ambiguous validation result,
or one failed recovery attempt requires a blocking attention request. Name the
single decision or permission needed and preserve the evidence already gathered:

```bash
work-graph attention request <ticket> \
  --kind authority \
  --question "May this worker run UI production rollback for failed revision <sha> to verified revision <sha>?" \
  --note "PR <url>; failed UI CD <url>; failed smoke <result>; no newer production revision was present at <UTC time>."
```

Use `product_decision` instead of `authority` when two fixes or rollback targets
remain plausibly safe. Do not use `--non-blocking`, weaken a control, or dismiss
the alert to keep the incident moving.
