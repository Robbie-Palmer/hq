# Compatibility examples

Compatibility keeps eligibility separate from ranking. A hard exclusion makes
an actor ineligible. A ranking signal only helps order actors that remain
eligible.

## Eligible actor

A repository task uses revision 1 of a repository-change complexity scale. The
scale defines `cross-cutting-change` as work that spans components and requires
explicit contract decisions. The actor accepts that level, has the required
authority, access, tools, and assessed capabilities, and can produce the
required evidence through its adapter.

The task requires 12,000 provider-context tokens and one account credit. The
actor reports 48,000 tokens and eight credits available. The compatibility
result has no hard exclusions. Its ranking signals include 36,000 tokens and
seven credits of headroom.

The actor also prefers the task's work class and one of its tags. Those matches
are ranking signals. Removing both preferences does not make the actor
ineligible.

## Ineligible actor

If the actor reports only 1,000 provider-context tokens, compatibility adds a
`capacity-insufficient` exclusion. If the actor has no limit for the task's
complexity-scale revision, compatibility adds a
`complexity-scale-unsupported` exclusion. Neither preference matches nor a
lower estimated cost can override either exclusion.

Observed capabilities contain an assessed level, assessment identity, and
assessment time. Sample sizes, success rates, and other measurements remain in
the analytics system that produced the assessment.

Executable versions of these cases live in `tests/compatibility.test.ts`.
