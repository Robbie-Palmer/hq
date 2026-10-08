# Repository writing review pilot

This directory records a public, repository-native review completed through
the writing editor command. `records.json` is the deterministic Vale output,
`decisions.jsonl` is the human decision, and `receipt.json` binds those records
to the source hashes before and after the edit.

The accepted proposal changed
`ui/content/projects/personal-knowledge-graph/adrs/027-ccpm.mdx` from "Utilize"
to "Use". The remaining `Optimize` alert stayed a finding because that rule
has no context-free rewrite.

Run `mise //ml-pipelines/writing-editor-evaluation:evaluate:reviews` to validate
the evidence and rebuild `scorecard.json`. The configured minimum is larger
than this one-edit pilot, so the recommendation remains `keep-opt-in`. Private
cohorts must store their records and decisions in the DVC-managed private data
area rather than Git.
