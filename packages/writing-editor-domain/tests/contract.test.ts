import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  createDecision,
  createProposal,
  createSuggestion,
  DecisionSchema,
  ProposalSchema,
  sourceReference,
  type SuggestionInput,
  SuggestionSchema,
  verifyProposalSource,
  verifySuggestionSource,
} from "../src";

const source = "Café is very unique. It works.";
const sourceRef = sourceReference("projects/editor.md", "git:abc123", source);
const timing = {
  reviewStartedAt: "2026-09-26T08:00:00.000Z",
  decidedAt: "2026-09-26T08:00:05.000Z",
};

function suggestionInput(
  startByte = 9,
  endByte = 20,
  sourceText = "very unique",
  replacement = "unique",
): SuggestionInput {
  return {
    producer: {
      id: "vale",
      version: "3.20.0",
      provenance: { kind: "rule", ruleId: "write-good.Uncomparables" },
    },
    source: sourceRef,
    span: { startByte, endByte, sourceText },
    replacement,
    category: "word-choice",
    reason: "Unique is already absolute.",
    confidence: 0.99,
  };
}

function suggestion(
  startByte = 9,
  endByte = 20,
  sourceText = "very unique",
  replacement = "unique",
) {
  return createSuggestion(
    suggestionInput(startByte, endByte, sourceText, replacement),
  );
}

describe("canonical JSON", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: [3, 1] } })).toBe(
      '{"a":{"b":[3,1],"y":2},"z":1}',
    );
  });

  it("rejects values outside the identity payload vocabulary", () => {
    expect(() => canonicalJson({ missing: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(new Date())).toThrow(/plain objects/);
  });
});

describe("suggestions", () => {
  it("calculates a stable ID and verifies a Unicode byte span", () => {
    const record = suggestion();

    expect(record.source.contentHash).toBe(
      "sha256:17c4675ee023027687993cedf44501021bcc5cbaf0d475549d5b89bb936709c6",
    );
    expect(record.suggestionId).toBe(
      "suggestion:v1:7b543fc1eb1be301db830b306d6dba40ff286148bd96309fc65a76cc6d45c11e",
    );
    expect(verifySuggestionSource(record, source)).toEqual({ ok: true });
    expect(SuggestionSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it("normalizes producer identity before calculating the ID", () => {
    const record = createSuggestion({
      ...suggestionInput(),
      producer: {
        id: " vale ",
        version: " 3.20.0 ",
        provenance: { kind: "rule", ruleId: " rule " },
      },
    });

    expect(record.producer).toEqual({
      id: "vale",
      version: "3.20.0",
      provenance: { kind: "rule", ruleId: "rule" },
    });
    expect(SuggestionSchema.safeParse(record).success).toBe(true);
  });

  it("rejects a forged ID and an internally invalid byte span", () => {
    const forged = { ...suggestion(), replacement: "singular" };
    expect(SuggestionSchema.safeParse(forged).success).toBe(false);
    expect(() => suggestion(9, 19)).toThrow(/byte length/);
  });

  it("reports stale content instead of remapping its span", () => {
    const verification = verifySuggestionSource(
      suggestion(),
      "Cafe is quite unique. It works.",
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("expected a stale source conflict");
    expect(verification.conflicts.map(({ kind }) => kind)).toEqual([
      "source-hash-mismatch",
      "source-text-mismatch",
    ]);
  });

  it("reports a span beyond the available source", () => {
    const verification = verifySuggestionSource(suggestion(), "short");

    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("expected a stale source conflict");
    expect(verification.conflicts.map(({ kind }) => kind)).toEqual([
      "source-hash-mismatch",
      "span-out-of-bounds",
    ]);
  });

  it("rejects an insertion in the middle of a UTF-8 code point", () => {
    const insertion = suggestion(4, 4, "", "e");
    const verification = verifySuggestionSource(insertion, source);

    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("expected an invalid UTF-8 boundary");
    expect(verification.conflicts.map(({ kind }) => kind)).toEqual([
      "span-not-on-utf8-boundary",
    ]);
  });
});

describe("proposals", () => {
  it("sorts members and calculates the proposal ID from the ordered IDs", () => {
    const later = suggestion(25, 30, "works", "succeeds");
    const earlier = suggestion();
    const proposal = createProposal([later, earlier]);

    expect(proposal.suggestions.map(({ span }) => span.startByte)).toEqual([9, 25]);
    expect(proposal.suggestionIds).toEqual(
      proposal.suggestions.map(({ suggestionId }) => suggestionId),
    );
    expect(proposal.proposalId).toBe(
      "proposal:v1:39df8114e262358117d51552aa2a31c58f570533aa40df47d6fe52e62be01510",
    );
    expect(verifyProposalSource(proposal, source)).toEqual({ ok: true });
  });

  it("rejects duplicates, mixed revisions, reordered members, and forged IDs", () => {
    const first = suggestion();
    expect(() => createProposal([first, first])).toThrow(/duplicate/);

    const otherRevision = createSuggestion({
      ...suggestionInput(25, 30, "works", "succeeds"),
      source: { ...sourceRef, revision: "git:def456" },
    });
    expect(() => createProposal([first, otherRevision])).toThrow(/same source revision/);

    const proposal = createProposal([suggestion(25, 30, "works", "succeeds"), first]);
    const reordered = {
      ...proposal,
      suggestions: [...proposal.suggestions].reverse(),
    };
    expect(ProposalSchema.safeParse(reordered).success).toBe(false);
    expect(
      ProposalSchema.safeParse({ ...proposal, proposalId: `proposal:v1:${"0".repeat(64)}` })
        .success,
    ).toBe(false);
  });

  it("deduplicates the shared hash conflict while retaining span conflicts", () => {
    const proposal = createProposal([
      suggestion(),
      suggestion(25, 30, "works", "succeeds"),
    ]);
    const verification = verifyProposalSource(proposal, "old");

    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("expected stale proposal conflicts");
    expect(verification.conflicts.map(({ kind }) => kind)).toEqual([
      "source-hash-mismatch",
      "span-out-of-bounds",
      "span-out-of-bounds",
    ]);
  });

  it("retains the old proposal ID when a stale proposal is explicitly migrated", () => {
    const oldProposal = createProposal([suggestion()]);
    const revisedSource = "Café is truly unique. It works.";
    const revisedSuggestion = createSuggestion({
      ...suggestionInput(9, 21, "truly unique", "unique"),
      source: sourceReference(
        "projects/editor.md",
        "git:def456",
        revisedSource,
      ),
    });
    const migrated = createProposal([revisedSuggestion], {
      migratedFromProposalId: oldProposal.proposalId,
    });

    expect(migrated.migratedFromProposalId).toBe(oldProposal.proposalId);
    expect(migrated.proposalId).not.toBe(oldProposal.proposalId);
    expect(verifyProposalSource(migrated, revisedSource)).toEqual({ ok: true });
    expect(
      ProposalSchema.safeParse({
        ...migrated,
        migratedFromProposalId: migrated.proposalId,
      }).success,
    ).toBe(false);
  });
});

describe("decisions", () => {
  it("keeps the full proposal for accepted, rejected, and changed outcomes", () => {
    const proposal = createProposal([suggestion()]);

    expect(createDecision(proposal, "accepted", timing)).toMatchObject({
      outcome: "accepted",
      proposalId: proposal.proposalId,
      proposal,
    });
    expect(createDecision(proposal, "rejected", timing)).toMatchObject({
      outcome: "rejected",
      proposal,
    });
    expect(createDecision(proposal, "changed", "distinctive", timing)).toMatchObject({
      outcome: "changed",
      replacement: "distinctive",
      proposal,
    });
  });

  it("requires a replacement only for changed decisions", () => {
    const proposal = createProposal([suggestion()]);
    const base = {
      schemaVersion: 1,
      recordType: "writing-decision",
      proposalId: proposal.proposalId,
      proposal,
      ...timing,
    };

    expect(DecisionSchema.safeParse({ ...base, outcome: "changed" }).success).toBe(false);
    expect(
      DecisionSchema.safeParse({ ...base, outcome: "accepted", replacement: "other" }).success,
    ).toBe(false);
    expect(
      DecisionSchema.safeParse({
        ...base,
        proposalId: `proposal:v1:${"0".repeat(64)}`,
        outcome: "accepted",
      }).success,
    ).toBe(false);
    expect(() => Reflect.apply(
      createDecision,
      undefined,
      [proposal, "accepted", "other"],
    )).toThrow(/cannot include a replacement/);
  });

  it("records valid review timing", () => {
    const proposal = createProposal([suggestion()]);
    expect(() => createDecision(proposal, "accepted", {
      reviewStartedAt: timing.decidedAt,
      decidedAt: timing.reviewStartedAt,
    })).toThrow(/must not precede/);
  });
});
