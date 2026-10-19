---
name: adr-writing
description: Use when asked to write, draft, edit, review, split, number, link, or supersede an ADR or architecture decision record.
---

# ADR writing

Record one architecturally significant choice and why it fit this project at
the time. A choice may adopt a group of technologies as one cohesive solution
when the parts have little value on their own.

Current ADR guidance favors a short, immutable record of one decision, its
context, and its consequences. Put the outcome and decisive reasons before
supporting detail. See
[Martin Fowler's 2026 summary](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
and the [ADR GitHub organization](https://adr.github.io/).

## Find the local contract

Before writing, inspect:

- the project's `index.md` or `index.mdx`;
- its existing ADRs, especially the latest few;
- the ADR loader or schema and the technology catalog; and
- repository instructions and validation tasks.

Follow the repository's filenames, frontmatter keys, statuses, link format,
and task runner. Use the next monotonic number. Do not reuse a gap.

## Keep the boundary sharp

An ADR owns one durable architecture choice driven by a functional need or
NFR. It explains the project-local forces, the chosen response, the competing
solutions, and the consequences.

Keep tightly coupled decisions together when the project will deliver, assess,
or reverse them as a unit. Split them when each part could stand as a useful
choice on its own. Do not split a coordinated technology adoption merely to
give each technology a separate ADR.

Keep these elsewhere:

- Vision, mission, product thesis, user needs, product-market competitor
  landscape, roadmap, and PRD-like material belong in the project index or a
  future PDR.
- Generic explanations of a technology or pattern belong on its technology
  page or an authoritative external site.
- Routine implementation steps belong in code, tests, plans, or operating docs.

Comparing competing technical solutions belongs in the ADR. Give the serious
options enough detail to show why the decision fits this problem, including
where a rejected option would fit better. Do not move that analysis to the
project index.

Include implementation facts only when they constrain the choice or form an
architectural invariant. Include point-in-time NFRs such as latency,
availability, security, cost, compatibility, data retention, or scale when they
changed the decision. State a measured value, source, or explicit assumption.
Do not invent a need or acceptance result.

Use current primary sources for facts that can change. Link to official limits,
prices, compatibility notes, specifications, or security guidance instead of
reproducing their documentation.

## Write a compact record

Use the local template. If it permits a summary, open with one or two sentences
that state the outcome and main reason. When the repository has no stronger
convention, use:

1. `Context` for the problem, decisive forces, and relevant prior decisions.
2. `Decision` for an active, unambiguous statement of what the project will do
   and why it fits those forces.
3. `Consequences` for meaningful benefits, costs, risks, and revisit triggers.

Add `Alternatives` only for genuinely viable options. Add acceptance
criteria when a Proposed ADR depends on evidence from a spike or measurable
gate. Do not add sections merely to fill a template.

Use the shortest record that preserves the decision logic. A longer ADR fits a
cohesive technology rollout, detailed NFRs, or close alternatives. Do not split
based on length. Cut generic material and routine implementation detail first,
then split only the parts that make sense as independent decisions.

## Treat `tech_stack` as adoption metadata

`tech_stack` records technologies this ADR introduces to this project's stack,
not document keywords, every technology mentioned, or existing dependencies.

- Include every catalogable technology newly adopted by this decision.
- Exclude technologies already adopted by the project, incidental
  implementation technologies not adopted by the decision, and rejected or
  comparison options.
- Omit `tech_stack` when the decision introduces no technology.
- An inherited ADR stub must not define `tech_stack`; it derives the source
  ADR's technologies.
- If the knowledge-base catalog lacks an introduced technology, add its
  canonical entry using the ADR's adoption date. If the project index keeps a
  full current-stack list, update that list too.

For example, an ADR that adopts Temporal for the first time may mention an
existing PostgreSQL deployment and reject AWS Step Functions. Use
`tech_stack: ["Temporal"]`.

## Preserve time order

Only reference ADRs that predate the current record. Within one project, those
records have lower sequence numbers. Never add a link from an older ADR to a
later one.

When creating a batch of ADRs, order them by dependency and write links
in one direction:

```text
foundational ADR <- dependent ADR <- later refinement
```

The dependent record may cite the foundation. The foundation must not predict
or link to the dependent record. Describe an undecided follow-up without an ADR
number or link.

Do not rewrite an accepted ADR when the decision changes. Create a later ADR
whose `supersedes` metadata points to the older record. Leave the older file
unchanged; repository code can derive the reverse relationship.

## Check the draft

Before finishing, verify that:

- the title and opening identify one cohesive choice;
- each paragraph helps explain why that choice fit this problem at that time;
- `tech_stack` contains all and only newly introduced technologies;
- every ADR link resolves backward in time;
- product strategy and generic technology guidance live elsewhere;
- volatile claims link to current primary sources;
- consequences include real costs or risks, not only benefits; and
- the repository's content validation passes through its prescribed task
  runner.
