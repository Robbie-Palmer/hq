# ADR 049 Recipe Site cooking timer pilot

Date: 2026-11-07

This is the first of the two pilots required by ADR 049. It tests whether a
project-scoped Redux Toolkit store improves the Recipe Site cooking timer
without moving browser effects or TanStack Query data into Redux. The ADR must
remain Proposed until the Personal Finance pilot is also complete.

## Migration boundary

The `/recipes` layout now creates one store through
`RecipeClientStateProvider`. The store has a cooking-timer slice and a small
recipe-session slice that holds the active persistence identity. Recipe
components use typed selectors and timer commands. The Recipe Site layout
remains the highest provider owner, with no site-wide provider.

Reducers own timer transitions and receive timestamps in event payloads. The
named timer effects adapter owns the clock, interval, storage and visibility
events, wake lock, audio, analytics, and custom-ID generation. Listener
middleware connects those adapters to accepted domain events. TanStack Query
continues to own remote recipe data.

## Measurements

| Measure | Before | Pilot | Result |
| --- | ---: | ---: | --- |
| Production timer-store infrastructure | 448 lines | 936 lines | +488 lines, or 109% |
| Baseline timer regression suite | 47 tests in 2.78 seconds | Not applicable | Pre-migration measurement |
| Pilot evidence suite | Not applicable | 55 tests in 5.40 seconds | Includes behavior, reducer, selector, adapter, replay, and render-isolation tests |
| Identity-scoped persistence code | About 87 lines | 118 lines | Same v2 envelope and key format, now isolated in one adapter |

The test durations are Vitest's reported durations from local mise runs. The
corresponding first-run mise wall times were 8.32 seconds before the migration
and 8.73 seconds for the 55-test pilot evidence run.

The line count includes the store factory, provider, typed hooks, slice,
effects adapter, persistence adapter, and public compatibility module.
The increase is real. Redux Toolkit removed hand-written subscription code,
but the provider, event boundary, adapters, and diagnostics cost more code than
the former module singleton. This pilot supports using the pattern for shared
state with meaningful diagnostics, not for small local state.

## Action log

The log names timer events and records their complete serializable payloads,
including clock timestamps. A rejected-transition assertion prints JSON ready
for dispatch into a fresh store. That proved more useful than the former
snapshot-only failure because it showed the accepted start followed by the
invalid resume.

The interval dispatches only when a displayed second changes, so subsecond
checks do not flood Redux DevTools. The in-memory replay log compacts after 500
actions into an identity event and a validated timer-state hydration event.
The compacted sequence remains replayable while memory use stays bounded.

## Persistence retained

The pilot retains the `cooking-timers:v2:<encoded user id>` key, version 2
envelope, embedded user ID check, runtime timer validation, absolute end
timestamps, reload catch-up, expired-timer completion, malformed-data
rejection, legacy unscoped-key removal, cross-tab storage input, and tolerant
storage failures. Switching identities still replaces the in-memory snapshot
with only that identity's validated record. Clearing private Recipe Site data
still removes every timer identity.

## Defects found

Three defects appeared while splitting reducers from effects:

1. Rejected resume and extension events initially unlocked audio and persisted
   state even though the reducer made no transition. The listeners now compare
   the timer slice before running event effects.
2. The first adapter captured `Date.now` and timer functions when the store was
   created. Installing a test clock later had no effect. The adapter now calls
   the current clock and scheduler functions at execution time.
3. Hydrating an empty account initially replaced one empty array with another.
   That broke the selector-stability proof when only the session slice changed.
   Empty-to-empty hydration now preserves the timer slice reference.

The migration tests found no persisted-data defect or identity leak. Existing
timer dock, inline timer, cook mode, PWA cleanup, persistence, and
account-isolation behavior tests pass against provider-owned store instances.

## Pilot result

The Recipe Site pilot passes its ADR 049 criteria. It provides deterministic
reducers, direct selector tests, serializable replay, selective React updates,
and named effect boundaries without a site-wide provider or query-cache copy.
The doubled infrastructure size is the main cost to weigh against the Personal
Finance pilot before accepting the ADR.
