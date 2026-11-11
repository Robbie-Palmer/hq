import { describe, expect, it } from "vitest";
import {
  canSaveDraft,
  chooseMask,
  chooseObject,
  chooseProposal,
  emptyDraft,
  rejectProposals,
} from "../domain/review-draft";

describe("annotation review draft", () => {
  it("requires object validity before a mask decision", () => {
    expect(chooseMask(emptyDraft, "accept", "proposal-1")).toEqual(emptyDraft);
    expect(canSaveDraft(emptyDraft)).toBe(false);
  });

  it("makes a rejected object skip mask review", () => {
    const draft = chooseObject(emptyDraft, "non_nucleus");

    expect(draft).toMatchObject({
      objectDecision: "non_nucleus",
      maskDecision: "not_applicable",
      selectedProposalId: null,
    });
    expect(canSaveDraft(draft)).toBe(true);
  });

  it("records the accepted proposal for a valid nucleus", () => {
    const objectDraft = chooseObject(emptyDraft, "valid_nucleus");
    const selected = chooseProposal(objectDraft, "cellsam");
    const accepted = chooseMask(selected, "accept", "cellsam");

    expect(accepted.selectedProposalId).toBe("cellsam");
    expect(canSaveDraft(accepted)).toBe(true);
  });

  it("rejects every proposal without attaching one", () => {
    const objectDraft = chooseObject(emptyDraft, "valid_nucleus");
    const selected = chooseProposal(objectDraft, "cellsam");
    const rejected = rejectProposals(selected);

    expect(rejected.selectedProposalId).toBeNull();
    expect(canSaveDraft(rejected)).toBe(true);
  });

  it("confirms the object when a proposal tile is selected", () => {
    expect(chooseProposal(emptyDraft, "cellsam")).toMatchObject({
      objectDecision: "valid_nucleus",
      maskDecision: null,
      selectedProposalId: "cellsam",
    });
    expect(rejectProposals(emptyDraft)).toEqual(emptyDraft);
  });
});
