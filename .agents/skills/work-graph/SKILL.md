---
name: work-graph
description: Operate this repository's deployed Work Graph to find, claim, update, prioritize, or finish tickets. Do not use merely because the task changes Work Graph code.
---

# Work Graph

Use the CLI as the agent interface. Start with `work-graph prime` when the
available commands or local setup are unclear.

Production credentials live in Doppler. API commands load the fixed
`work-graph/prd_work_graph` config automatically when the environment is not
already present. If automatic startup is unavailable, use the explicit form:

```sh
doppler run --project work-graph --config prd_work_graph -- work-graph <command>
```

Never print, copy, or persist the Cloudflare Access values. Codex sessions use
their thread ID as worker provenance. `WORK_GRAPH_WORKER_ID` overrides it; other
clients must set that variable to use the implicit active-lease workflow.

## Normal loop

1. Run `work-graph ready`. Inspect a candidate with `work-graph show <ticket>`.
2. Run `work-graph claim [ticket]`. With no ticket, the server chooses the
   highest-priority ready item.
3. Record durable findings or a handoff with
   `work-graph note <ticket> --content "..."`. The CLI finds the active lease
   and fencing epoch. Run `work-graph touch <ticket>` before a lease expires.
4. Release repository-backed work only after merge and production deployment:
   `work-graph release <ticket> --merge-evidence <url> --deployment-evidence <url>`.

For changes under `packages/work-graph-cli`, installing the merged client is
part of deployment. Pull the merged revision, run `work-graph self-update` from
that checkout, and verify the changed command before releasing the ticket. On a
machine with an older client, bootstrap once with
`mise //packages/work-graph-cli:install:global`.

`note`, `touch`, `decompose`, `attention request`, `release`, and `cancel` use
the ticket's active lease. Pass `--lease-id` and `--epoch` together only when a
script already has both values.

## Plan with the critical path

Run `work-graph critical-path` for the global plan. Narrow an owner review with
`--initiative-id <initiative>` or `--project-id <project>`. Use
`--root-work-item-id <ticket>` to explain one exact outcome. Do not combine a
root filter with an initiative or project filter.

Read a blocking path from its priority outcome to the unresolved leaf. Paths
can cross decomposition and dependency edges. `ready` leaves can start now,
`active` work already has a lease, `stale` work can be reclaimed, and
`needs_attention` requires the recorded human response. Parallel branches are
claimable leaves that can advance independently. Prefer the highest-priority
branch that fits the requested scope.

Use `--json` for automation. Consume `nodes` and `edges` as the deduplicated
graph, `targetOutcomeIds` as the selected outcomes, `blockingPaths` as the
explanations, and `readyLeafIds`, `blockingAttentionIds`, and
`parallelBranches` as work-selection lists. Inspect `inclusionReasons` when an
item's presence is surprising.

Treat the result as a live structural projection, not a duration estimate or
delivery forecast. Verify a surprising path with `work-graph show <ticket>`,
`work-graph metadata dependencies <ticket>`, and `work-graph metadata
decompositions <ticket>`. Revise stored graph state with the commands below,
then rerun the projection.

## Changes to the plan

- Reorder a ticket with `work-graph priority move <ticket> --above <ticket>` or
  `--below <ticket>`. Ticket order is local to its scheduling project.
- Remove a project or initiative from active scheduling with `work-graph scope
  archive <scope> --reason "..."`. Use `scope restore` to return it at the
  median active rank and `scope list --all` to audit archived scopes.
- Add a blocking edge with
  `work-graph dependency add <dependent> <blocker>`.
- Use `work-graph expedite <ticket> --reason "..."` only for an explicit
  interruption. An expedite temporarily donates urgency to unresolved blockers.
- Use `work-graph attention request` when progress needs a decision, authority,
  access, review, or help. A blocking request ends the lease.
- `cancel` means the outcome is no longer wanted. It is not a way to return
  unfinished work to the queue.

Prefer the short commands above. Use `metadata`, explicit lease fields, and
`--json` for audits, recovery, or automation that needs the full contract.
