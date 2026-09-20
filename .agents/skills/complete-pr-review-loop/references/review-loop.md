# Complete the PR review loop

Prepare completed work, publish a draft PR, and stay with it until it is ready
for human review. Do not merge unless the user explicitly asks.

## Before opening the PR

Do not use the PR as the first test run.

1. Sync with the intended base and inspect the full diff.
2. Match tests to the changed behavior. Use unit tests for isolated logic,
   integration tests for boundaries, and Playwright for browser workflows that
   lower-level tests cannot cover.
3. Run the relevant local tasks from `AGENTS.md`, including coverage for each
   affected project. Match CI and SonarQube locally where possible. This
   repository requires at least 80% coverage on new code.
4. Fix local failures. If infrastructure prevents a check from running, record
   the limitation. Do not open a PR to discover a predictable test or coverage
   failure.

Commit only the intended work, push it, and open or reuse a draft PR. Include an
accurate summary, validation results, and any specific QA need.

## Review cycle

After a push or PR state change, wait roughly 3 to 5 minutes before taking one
current-state snapshot. Do not live-poll. For a slow or rate-limited reviewer,
schedule one later check if the review is likely to add value. Otherwise report
the limitation.

Inspect:

- CI failures and expected skips;
- review comments, change requests, and unresolved threads;
- SonarQube's gate, issues, and hotspots; and
- rolling bot comments that may have changed in place.

Treat results as stale after a push. Trust GitHub's association between checks
and the PR head unless recent changes or conflicting evidence create a real
staleness risk. If the SonarQube decoration is missing or lacks detail, query
`https://sonarcloud.io` for project `Robbie-Palmer_personal-site`.

Classify each finding as a true issue, worthwhile nit, stale or duplicate, or
false positive. Fix true issues, add regression coverage, and give concise
evidence when rejecting a finding. Batch coherent fixes, rerun local checks,
push, and repeat the cycle. Avoid code churn for reviewer preference alone.

For every stateful AI-review thread, reply with exactly one disposition before
resolving it:

- `/ai-review confirm-fixed <evidence>` after the pushed fix passes a
  current-head replay;
- `/ai-review acknowledge <reason>` for accepted or deferred issues; or
- `/ai-review reject <reason>` for false, invalid, stale, or duplicate findings.

Keep legitimate unfinished findings open. Once you post a disposition with its
evidence or explanation, resolve the thread and continue. Do not wait for the
bot to acknowledge the reply or react to it. Use the finding-ID form from the
rolling comment only when GitHub could not create a diff thread.

## Preview QA

Use automated tests to prove objective behavior. Do not use computer control or
screenshots to repeat unit, integration, or Playwright checks.

Use manual browser control only when automated assertions cannot settle a
subjective design question, such as ambiguous layout, visual balance,
animation, or responsive nuance. Check the smallest relevant path. Take
screenshots only when they help judge or report that question.

Use only the preview access method documented in `AGENTS.md`. Do not search
Doppler, the repository, or unrelated configuration for credentials. If the
documented credentials or browser session are unavailable, report the limit and
stop preview QA. Never expose credentials.

If justified preview QA needs sign-in, seeded data, the API Worker, or
ingestion, add `preview:backend` and comment exactly `/preview-backend`.

## Draft and ready phases

Keep the PR in draft until required checks and SonarQube pass, expected skips
are understood, draft-visible reviews are settled, any justified preview QA
passes, and all fixes are pushed. Refresh once for late feedback, then mark it
ready for review.

Wait for ready-only reviewers and the automatic custom AI review, then repeat
the review cycle. The custom reviewer overwrites the top-level comment marked
`<!-- stateful-ai-code-review -->`, so fetch it again after each run.

Request another review with exactly `/ai-review` only when the head changed
after the latest completed custom review. Do not pay for another run when the
head is unchanged or only nits, stale findings, duplicates, or false positives
remain. If a run lacks model coverage or credits, report the limitation.

## Completion gate

Finish when the PR is ready for review and:

- CI and SonarQube pass;
- no true SonarQube, reviewer, or custom-review finding remains;
- any justified preview QA is complete;
- remaining nits and false positives have explicit dispositions; and
- no fix is uncommitted or unpushed.

Report the PR URL, final commit, validation and QA status, review rounds, and
material limitations. Leave the PR for human merge.
