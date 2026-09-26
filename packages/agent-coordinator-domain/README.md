# Agent Coordinator contracts

This package defines the records exchanged by the Agent Coordinator, Work
Graph adapters, and worker adapters. Every durable record has a
`schemaVersion`, a `recordType`, and strict validation. Version 1 readers reject
unknown versions, missing fields, extra fields, duplicate identifiers, and
cross-field contradictions.

The records use capability, authority, access, tool, evidence, work-class, and
authentication-path identifiers. They do not store model names or subscription
product names. An adapter can map current products onto these identifiers
without changing saved task or actor records.

## Contract boundaries

`TaskRequirements` says what the work needs. `ActorProfile` says what a person
or agent declares, what completed work has shown, what tools and access it has,
its cost, and its current capacity. `OwnerPolicy` limits authentication paths,
authority, budgets, work classes, and concurrency. `WorkerAdapterIdentity`
identifies the process that will run the work. `ExecutionSessionIdentity` gives
each run a stable identity and links a replacement session to its predecessor.

Call `evaluateCompatibility` before claiming work. The result has two separate
lists:

* `hardExclusions` contains failed requirements. Any entry makes the pairing
  ineligible.
* `rankingSignals` contains comparable observations such as interest matches,
  observed success, capacity, and estimated cost. A signal never overrides an
  exclusion.

## Worked examples

A `complex` task requires level 4 TypeScript domain modeling, repository write
authority, repository access, `git`, test results, and checkpoint handoffs. An
actor declares level 5, has observed level 4 with a 90% success rate, and has
the required authority and access. Its native-client adapter uses an allowed
authentication path and can produce both evidence kinds. The policy has spare
concurrency and a USD 5 session limit. `evaluateCompatibility` returns no hard
exclusions. It reports the actor's one-level declared capability margin, 0.9
observed confidence, available capacity, interest match, preferred-tool match,
and estimated cost as ranking signals.

If the same actor loses repository access, the result contains
`required-access-missing`. A high observed success rate or lower cost remains
visible for audit, but cannot make the pairing eligible. If the adapter changes
to an authentication path outside the owner's allowlist, the independent
`authentication-path-denied` exclusion applies. The executable versions of
both cases live in `tests/compatibility.test.ts`.
