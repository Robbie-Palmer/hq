# Project economics domain

This package defines the storage-independent contract for project operating
costs and operational evidence. It keeps source identity, source revision,
ingestion run, and method revision on every observation. Collectors can replay
the same source item without creating a second logical fact, while a later
provider revision can replace the current projection without deleting history.

Cost attribution and certainty are separate fields. Direct, shared, allocated,
unallocated, and excluded records have different `kind` values. Actual,
estimated, and forecast values use the independent `basis` field. Credits keep
their billed currency and use `effect: "credit"`; queries never add unlike
currencies.

Each cost observation is the amount recognised for its `servicePeriod`.
Collectors split or accrue prepayments before recording them. The cumulative
query includes direct and allocated observations whose service periods fall
inside the requested range. It omits gross shared pools, residuals, and
excluded records so portfolio totals cannot count a shared bill twice.

Shared platform costs use versioned, effective-dated rules. A rule can assign a
bill directly, divide it equally among active adopters, apply explicit weights,
or use measured consumption. Eligibility comes from a project's layer or
preferred-slot adoption period and lifecycle period. Closed and archived
projects stop receiving cost unless the selected rule revision explicitly
includes them. Missing consumption remains unallocated unless a provider total
can establish the measured share. Allocation reports reconcile gross cost to
project shares plus the unallocated amount and attach the rule revision to
every share.

Repository inventories require an exact 40-character commit SHA. Language
bytes reconcile to their declared denominator. Source lines separate
production code, tests, tooling, configuration, and unclassified code;
documentation has its own count outside the source total.

Telemetry distinguishes numeric observations from unavailable, uncollected,
private, withheld, and not-applicable states. A partial value must state its
limitation, and a zero-denominator ratio cannot report a value.
