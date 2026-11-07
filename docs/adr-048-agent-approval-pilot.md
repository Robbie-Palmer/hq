# ADR 048 AgentApprovalView pilot

Date: 2026-11-07

## Scope and boundary

This pilot moves Recipe Site's `AgentApprovalView` workflow into a stable
XState 5 machine. The machine owns request phases, the selected decision,
reauthentication, OAuth interruption and resumption, errors, cancellation, and
the final result. Browser APIs, Better Auth, storage, and Recipe API calls live
in replaceable promise actors.

The React boundary supplies the current user ID and email, subscribes with
`@xstate/react`, and forwards session changes through one named event. The
component does not use TanStack Query, so the machine does not duplicate a
query cache. It retains the immutable agent and optional host returned by its
request actors because those values render the approval request and determine
whether approval is allowed.

The implementation uses open-source XState runtime, inspection, React, and
`xstate/graph` APIs. It has no Stately Studio dependency.

## Measurements

| Measure | Before | After |
| --- | ---: | ---: |
| Production physical lines | 592 | 1,169 |
| `AgentApprovalView` physical lines | 592 | 425 |
| Framework-neutral machine lines | 0 | 574 |
| Browser actor adapter lines | 0 | 170 |
| Direct machine and graph test lines | 0 | 704 |
| Component behavior tests | 16 | 16, unchanged |
| React `useState` calls in the view | 10 | 0 |
| React effect hooks in the view | 3 | 1 |
| React effect lines | 56 | 9 |

The production implementation grew by 577 physical lines. Most of that cost is
the typed transition table, named guards and actions, actor contracts, and the
browser adapter. The component dropped 167 lines and no longer needs its
hotspot exception.

The retained React effect only sends `SESSION_CHANGED`. XState now owns the
initial page read, request loading and cancellation, automatic OAuth resume,
and every decision or recovery effect.

## Test and graph results

The focused uninstrumented run completed 25 tests in 1.60 seconds. That run
contains the 16 preserved component tests and nine new machine tests. Scoped
coverage completed in 3.40 seconds of Vitest time and reported:

| Coverage | Result |
| --- | ---: |
| Statements | 88.70% |
| Branches | 81.57% |
| Functions | 88.09% |
| Lines | 91.52% |

The production build and static UI checks passed. A repository-wide test run
with four workers passed 2,596 of 2,597 tests; the remaining unrelated wedding
planner playlist test hit its five-second timeout and passed when rerun alone.
The repository-wide coverage run produced 68 timeouts across unrelated suites
under instrumentation, so the coverage figures above use the affected view,
machine, and browser adapter with both the component and machine tests.

The graph checks assert that 16 stable state nodes are reachable and that the
declared graph has 27 transitions. Fifteen bounded scenarios generate 227
shortest paths, 494 simple paths, and 1,594 traversed transition instances.
Each scenario stops after 250 adjacency iterations. Transient routing nodes
settle in the same macrostep, so the stable state count excludes the three
explicit routing nodes.

The direct tests cover approval, denial, request failure, reauthentication,
OAuth start, OAuth resumption, account mismatch, cancellation, invalid events,
and actor cleanup. The failure helper records event and transition lines from
XState's inspection API and adds them to a timed-out sequence assertion.

## Cases found

Graph traversal found one missing invariant during the pilot. A stale
`fresh_session_required` response could select provider loading after the
session had disappeared. The UI would normally leave the active state first,
but the transition did not state that requirement. The machine now uses the
named `canReauthenticate` guard, which requires both the actor error and a live
session.

The tests also make three existing behaviors explicit:

- approval is forbidden after request failure, while denial remains available;
- selecting an unlinked OAuth provider is ignored; and
- leaving request or host loading aborts the invoked actor.

## Pilot assessment

The machine makes interruption and cancellation rules easier to test without
React, and the graph check found a real missing guard. The cost is substantial:
577 more production lines and a larger API vocabulary for one view. The second
ADR 048 pilot should compare whether an import drawer finds a similar defect
and whether its effect reduction justifies the same amount of structure. This
pilot alone is not enough to accept ADR 048.
