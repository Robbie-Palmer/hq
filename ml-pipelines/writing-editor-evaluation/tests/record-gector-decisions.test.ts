import { describe, expect, it } from "vitest";
import { createProposal } from "writing-editor-domain/proposals";
import { createSuggestion, sourceReference } from "writing-editor-domain/suggestions";

import { buildEditHunks } from "../src/match-edits";
import { classifyProposal } from "../src/record-gector-decisions";

const source = "This are a sentence.";
const producer = {
  id: "gector-2024",
  version: "fixture",
  provenance: { kind: "model" as const, modelId: "fixture", revision: "fixture" },
};
const proposal = createProposal([createSuggestion({
  producer,
  source: sourceReference("fixture.md", "fixture", source),
  span: { startByte: 5, endByte: 8, sourceText: "are" },
  replacement: "is",
  category: "grammar/gector-2024",
  reason: "Fix agreement",
})]);

describe("GECToR decision classification", () => {
  it("accepts an exact observed proposal", () => {
    const hunks = buildEditHunks(source, "This is a sentence.", 1_000);
    expect(classifyProposal(proposal, source, hunks)).toEqual({ outcome: "accepted" });
  });

  it("records a reviewer-authored replacement as changed", () => {
    const hunks = buildEditHunks(source, "This was a sentence.", 1_000);
    expect(classifyProposal(proposal, source, hunks)).toEqual({
      outcome: "changed",
      replacement: "was",
    });
  });

  it("rejects a proposal when the observed edit is unrelated", () => {
    const hunks = buildEditHunks(source, "This are one sentence.", 1_000);
    expect(classifyProposal(proposal, source, hunks)).toEqual({ outcome: "rejected" });
  });

  it("does not infer an outcome from an edit that crosses the proposal boundary", () => {
    const hunks = buildEditHunks(source, "This is.", 1_000);
    expect(classifyProposal(proposal, source, hunks)).toEqual({ outcome: "rejected" });
  });
});
