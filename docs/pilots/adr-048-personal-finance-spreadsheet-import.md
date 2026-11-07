# ADR 048 Personal Finance import pilot

Date: 2026-11-07

## Selection

The second ADR 048 pilot models `SpreadsheetImportDrawer`. It is the smallest
Personal Finance importer that still covers the required workflow: a local file
read, format and row validation, review, submission, failure, retry, closure,
and cleanup.

The other candidates were weaker pilot subjects. `AccountHistoryImportDrawer`
starts with pasted text, so it cannot test file-reader ownership.
`HmrcStaticImportDrawer` coordinates two optional files and tax-year-specific
rules; that larger product change would make it harder to judge the cost of the
state machine itself. The spreadsheet drawer has one file and one review loop,
while still submitting three product request shapes.

## Boundary

`spreadsheet-import-machine.ts` is framework-neutral TypeScript built with the
XState 5 typed `setup` API. Named events, guards, actions, and replaceable
callback actors define the workflow. `@xstate/react` is limited to the drawer
boundary.

The machine context contains the selected local file while it is being read,
the resulting review, an immutable submission request, and a display error.
The Asset Tracker provider remains the owner of household members, accounts,
and saved histories. The machine neither mirrors provider or TanStack Query
state nor persists an XState snapshot. The implementation uses only the open
source `xstate`, `xstate/graph`, and `@xstate/react` packages.

## Results

| Measure | Result |
| --- | --- |
| Runtime dependencies | `xstate` 5.33.3 and `@xstate/react` 6.1.0 |
| Production implementation | 364-line machine module; drawer integration changed by +156/-95 lines, net +61 |
| Test implementation | 552-line direct and graph suite; 67 component-test lines added |
| Focused coverage run | 17 Vitest cases in 5.75 seconds; machine coverage 94.73% statements, 93.1% branches, 92.85% functions, and 96.15% lines |
| Graph | 8 reachable stable states, 9 named transition event types, 128-state traversal bound |
| React effects | 0 `useEffect` calls before and after; 5 workflow `useState` calls removed and 5 product-input `useState` calls retained |

Direct machine tests cover success, file-read recovery, invalid review,
submission recovery and retry, closure, file-type and size rejection, and
forbidden events. Two cancellation tests assert that the file-read and submit
actors receive an aborted signal and leave the actor tree when their state
exits. The graph suite finds shortest paths to all eight states, generates
bounded simple paths, and replays targeted sequences for each declared
transition. Test failures include the captured event and state-transition
trace; development builds log the same transition records.

## Cases found

The old drawer cleared its file only after a successful submission. Cancelling
and reopening could therefore show the previous review. The machine's `closed`
entry action now clears all workflow context, and a component test covers the
reopen path.

The existing component suite covered valid balance, capital-flow, and income
imports plus invalid rows. It did not cover a failed browser file read, a
failed submission followed by retry, closure cleanup, forbidden outcome
events, or actor cancellation. The pilot added those cases without changing
the existing four assertions.

## Assessment

This drawer meets the second-pilot checks in ADR 048. XState adds substantial
test and machine code for a 459-line component, but the extra structure exposes
the actor lifetime and forbidden transitions that the previous setters did not
express. The retained local form fields are a useful boundary: moving import
kind, account, ownership, and contribution options into machine context would
add ceremony without improving the workflow graph.

This report covers only the Personal Finance pilot. ADR 048 still requires the
separate Agent Approval pilot evidence before acceptance.
