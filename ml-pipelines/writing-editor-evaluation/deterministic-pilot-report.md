# Deterministic repository pilot

Date: 2026-10-24

This pilot ran the native Vale review command against three project pages and
three ADRs at revision `8a53a2008bf20aa7ff9d2ff53bc7b83c9f658669`. None of the
six artifacts belongs to the nine-artifact development fixture. The private
DVC evidence stores the exact records, proposal decisions, receipts, consent,
retention policy, publication revision, and manual edits after the tool pass.
Every session records an empty manual-edit list. Git diffs were not used as
proposal outcomes.

## Cohort

| Type | Artifact |
| --- | --- |
| Project page | `ui/content/projects/bioinformatics-platform/index.mdx` |
| Project page | `ui/content/projects/commercial-knowledge-graph/index.mdx` |
| Project page | `ui/content/projects/customer-health-forecasting/index.mdx` |
| ADR | `ui/content/projects/agent-first-writing/adrs/008-jsdiff-source-alignment-without-outcome-inference.mdx` |
| ADR | `ui/content/projects/personal-knowledge-graph/adrs/030-downgrade-cloudflare-tf.mdx` |
| ADR | `ui/content/projects/work-graph/adrs/006-contextual-stack-ranking.mdx` |

Git tracks only the DVC pointers
`data/review-evidence/deterministic-pilot.dvc` and
`data/review-evidence/deterministic-pilot-post-hardening.dvc`. The evidence
objects remain in the private writing-evaluation remote.

## Result

The first pass returned 11 findings and four proposals. One proposal changed
`utilize` to `use` and was accepted in 2.093 seconds. Three proposals changed
the Work Graph term `expedite` to `speed up`; all three were rejected in 7.185
seconds. Useful proposal yield was therefore 25%, from a sample too small for
adoption.

Six findings came from `ServesAs` matching the noun `features`. Those alerts
did not describe an edit. The pilot removed `features` from that rule and
removed `expedite` from the exact-replacement allowlist.

The hardened pass returned five detection-only findings and no proposals. It
recorded 15.926 seconds across the six complete review sessions. The remaining
findings were four context-sensitive plain-word cases and one dependent
`-ing` clause. The accepted edit had already changed the source, while the
three unsafe proposals no longer existed.

## Baseline comparison

| Workflow | Artifacts | Findings or proposals | Outcomes | Timing | Result |
| --- | ---: | ---: | --- | --- | --- |
| Native deterministic pilot, first pass | 6 | 11 findings, 4 proposals | 1 accepted, 3 rejected | 9.278 seconds for proposal decisions | 25% useful yield; harden rules |
| Native deterministic pilot, hardened pass | 6 | 5 findings, 0 proposals | No invented outcomes | 15.926 seconds for full sessions | Keep review-only while volume grows |
| Frozen manual workflow | 9 | 43 Vale findings | 15 self-contained observed edits, 28 boundary-crossing edits | Not measured | Git evidence cannot supply decisions |
| Frozen and broad GECToR baseline | 166 reviewed artifacts | 411 proposals | 87 accepted, 9 changed, 315 rejected | Not measured | 23.4% useful yield; reject default adoption |

The manual-workflow numbers describe published diffs, not accept or reject
decisions. The comparison keeps them separate. The GECToR scorecard also lacks
measured review time and quality ratings, which blocks adoption independently
of its low useful yield.

## Ranked remaining failures

| Rank | Edit behavior | Frequency | Review cost | Fact risk | Term risk | Intent risk | Voice risk | Disposition |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | Choose a context-fitting replacement for `leverage`, `facilitate`, or `optimize` | 4 findings | 6.816 seconds across the three affected project pages | Medium | High | High | Medium | Run one bounded local-suggestion experiment |
| 2 | Rewrite a dependent `-ing` clause without deleting its causal claim | 1 finding | Included in a 2.307-second page review | High | Low | High | High | Gather more examples before a model experiment |
| 3 | Preserve domain terms that resemble generic style faults | 3 rejected proposals | 7.185 seconds | Low | High | High | Low | Fix the deterministic allowlist, completed in this pilot |
| 4 | Distinguish the noun `features` from a copular verb | 6 false findings | Initial finding time was not measured | Low | Medium | Medium | Low | Fix the deterministic rule, completed in this pilot |

## Next experiment

The next model experiment should target only context-sensitive lexical
substitution for `leverage`, `facilitate`, and `optimize`. It should receive the
sentence around an existing Vale finding and return either one exact local
replacement or no suggestion. It must not rewrite surrounding text. Product
names, API terms, quoted text, code, frontmatter, tables, and benchmark uses of
`optimize` remain out of scope.

The experiment needs at least 20 reviewed proposals across ADRs and project
pages before an adoption decision. The existing gates still apply: at least
60% useful yield, no more than 5% artifact-level regression, no factual,
terminology, intent, or voice failure, and no more than 120 seconds median
review time. Until then, the deterministic layer remains review-only.
