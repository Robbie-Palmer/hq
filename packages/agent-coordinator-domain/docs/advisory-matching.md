# Advisory matching

Advisory matching proposes one ready task and worker without claiming a Work
Graph lease. The caller supplies a bounded ready-queue snapshot, actor and
adapter observations, the applicable owner policy, and a value estimate for
each task.

The matcher applies compatibility checks first. Authority, access, budget,
capacity, capability, tool, evidence, authentication, and concurrency failures
exclude a pairing. Excluded pairings have no score inputs, so a low price or a
preference cannot make unsafe work eligible.

Eligible pairings use this deterministic order:

1. Work Graph expedite state and initiative, project, and ticket rank
2. Expected task value
3. Observed and declared capability margin
4. Estimated session cost
5. Resource headroom
6. Handoff cost

For the same task, expiring prepaid capacity breaks a tie after those inputs.
Stable task, actor, and adapter identifiers settle any remaining tie. The
matcher can return an idle decision when there is no ready work, no available
worker, no eligible pairing, or no work above the owner's value floor.

`createAdvisoryDecision` returns the proposal, all pair evaluations, hard
exclusions, score inputs, context summary, budget limits, and the effect a
claim would have. `declineAdvisoryDecision` records a rejection in the calling
workflow. `requestAnotherAdvisoryDecision` ignores the rejected pairing and
runs the same ordering again.

Only `confirmAdvisoryDecision` receives a claim port. Before it calls that
port, it reruns matching against the current input and requires the same
decision fingerprint. A changed queue, actor observation, policy, setting, or
task requirement makes the decision stale. An expired queue snapshot fails
with `queue-stale`.
