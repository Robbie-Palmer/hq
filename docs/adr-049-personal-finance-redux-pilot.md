# ADR 049 Personal Finance Redux pilot report

This report covers the second pilot required by
[ADR 049](../ui/content/projects/personal-engineering-platform/adrs/049-project-scoped-redux-toolkit-stores.mdx):
replacing the mutable data and status core of Personal Finance's
`AssetTrackerProvider` with a project-scoped Redux Toolkit store.

## Migration boundary

Redux now owns the in-browser `AssetTrackerData` snapshot, whether that snapshot
contains local changes, and the local load or save status. Two feature slices
handle data and status events. A store factory creates one instance under the
Asset Tracker client layout.

The existing browser API remains the persistence boundary. The pilot did not
change `api/assettracker.ts`, the browser repository, or the domain command API.
Derived financial values remain selectors over `AssetTrackerData`. No query
result is copied into Redux, and the pilot adds neither RTK Query nor a
site-wide provider.

`createAssetTrackerCommandAdapter` owns localStorage access and async command
completion. Reducers receive only serializable event outcomes. The store keeps
Redux Toolkit's default immutable-state and serializable-state checks enabled
with no ignored paths. Development builds enable Redux DevTools and action
stack traces; production builds disable them.

## Measurements

The store and command adapter add 347 production lines. The provider changed
from 961 to 976 lines because the 75-line local React state core was replaced
by store creation, command events, and selector wiring while the existing
command facade stayed in place. Selector migration across 49 consumer modules
brings the complete production diff to 1,326 additions and 422 deletions, a net
increase of 904 lines. The pilot adds 335 lines of direct tests across 11
cases.

The focused state suite ran in 3.50 seconds. Its coverage run took 3.12 seconds.
The new `state` directory reached 99.00% line, 98.21% statement, 97.22%
function, and 83.33% branch coverage. The full 843-test Personal Finance run
took 63.25 seconds and hit two timeouts under concurrent load. Both timed-out
files passed together on immediate replay, with 59 tests completing in 13.54
seconds. A complete UI run saturated the shared worker pool, produced timeouts
across unrelated Recipe, Wedding Planner, platform, and Personal Finance tests,
and was stopped after 315.63 seconds. Focused replays remain the reliable
evidence on this host.

The action log was useful for separating storage failures from rejected domain
commands. A failed transition prints its operation, reason, and JSON action
sequence. `replayAssetTrackerActions` reproduced the exact post-failure state
in a direct test. The sequence is concrete enough to distinguish a stale load,
a browser write failure, and a domain rejection. The tradeoff is size:
committed events contain the validated `AssetTrackerData` snapshot so the
sequence can replay without calling storage or domain commands.

Persistence code retained all 801 lines of `api/assettracker.ts`, including
runtime schema validation, compatibility restoration, referential-integrity
checks, and localStorage writes. The 1,021-line browser repository and
2,837-line domain command module also remain unchanged.

## Defects and constraints found

The pilot found that `AssetTrackerApi.reset` can throw a plain storage error
from `removeItem`, unlike writes that use `AssetTrackerStorageError`. The old
provider already treated every reset failure as a storage failure. The adapter
preserves that behavior with a reset-specific rejection event instead of
changing the API.

The full Personal Finance test run can exhaust its existing five-second
component timeouts when 92 files run concurrently. The two failures did not
reproduce when the affected files ran together. The complete UI run made the
problem worse and timed out dozens of unrelated tests. This is test-runner
capacity noise rather than a product failure, but it makes the full-suite
runtime a weak benchmark for small state changes.

Redux Toolkit's development serializability check took 87 ms for one demo
snapshot during the saturated run and printed its standard performance
warning. The pilot leaves the check enabled with no ignored state paths. The
measurement shows a real development cost for storing the full validated
working copy, even though production builds do not run the check.

The provider's public command facade is still large. Redux removes the shared
mutable context value and gives consumers selective subscriptions, but it does
not reduce the number of product operations. Splitting that API by feature
would be a separate refactor and was outside this pilot's boundary.

## Assessment

The pilot meets the second ADR 049 trial conditions. It provides event-shaped
updates, deterministic serializable reducers, selective React subscriptions,
direct reducer and selector tests, a no-rerender test across slices, and
replayable failure output. It also keeps storage validation and domain behavior
where they were. The extra 904 production lines are substantial, but most are
explicit selectors and command event names rather than another persistence or
business-rule implementation.
