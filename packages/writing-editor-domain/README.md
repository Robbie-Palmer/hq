# Writing editor domain

This package implements version 1 of the Agent-first Writing Editor record
contract. It gives rule and model producers runtime-validated records for
findings, local suggestions, grouped proposals, and review decisions.

A finding marks a source span that needs attention when the producer cannot
supply a safe replacement. This is the shape used by detection-only Vale
rules. Findings have stable IDs, source verification, categories, reasons, and
producer provenance. They do not have replacement text and cannot be applied
as edits. A later rewrite producer can use them as input when it creates a
suggestion and proposal.

The contract uses half-open UTF-8 byte spans. A producer must hash the exact
source bytes it inspected and copy the text covered by each span. Consumers
call `verifySuggestionSource` or `verifyProposalSource` before showing or
applying a record. A mismatch is a conflict. Consumers must not remap a stale
span without recording a separate migration. A migrated proposal stores the old
ID in `migratedFromProposalId`.

`createFinding`, `createSuggestion`, and `createProposal` calculate IDs from
canonical JSON and SHA-256. A finding ID covers the producer, source revision,
span, and category. A suggestion ID also covers its replacement. A proposal ID
covers its canonically ordered member IDs. Reasons, confidence, and detailed
provenance remain editable metadata and do not change record identity.

Canonical JSON recursively sorts object keys by UTF-16 code unit and preserves
array order. It uses JavaScript's JSON encoding for finite numbers, strings,
booleans, and null, then hashes the resulting UTF-8 bytes. Identity payloads do
not accept `undefined`, non-finite numbers, or objects with custom prototypes.
The tests contain fixed hashes so another language can verify its encoder.

Decisions embed the complete proposal. This keeps the ordered member IDs,
original suggestions, producer versions, and source revision beside the
accepted, rejected, or changed outcome. They also record when review started
and when the author chose the outcome.

## Repository review

Run a review with:

```sh
mise //packages/writing-editor-domain:review -- review.json
```

The manifest names the source file and revision and contains validated ADR 003
findings and proposals:

```json
{
  "sourcePath": "draft.md",
  "documentId": "draft.md",
  "revision": "git:abc123",
  "findings": [],
  "proposals": []
}
```

`sourcePath` is relative to the manifest. The command verifies the file hash,
UTF-8 byte spans, recorded source text, document ID, and revision before it
shows any record. Detection-only findings appear separately from actionable
proposals. Each proposal includes an exact unified diff.

The command appends each accepted, rejected, or changed outcome to
`<sourcePath>.decisions.jsonl`. Pass `--decisions <path>` to choose another
log. Quitting leaves the source untouched, and the next run skips proposals
already present in the log. After every proposal has a recorded outcome, the
command checks accepted edits for overlap and atomically writes the source.
It does not commit or publish the result.
