import { describe, expect, it } from "vitest";
import {
  canSaveDraft,
  chooseMask,
  chooseObject,
  emptyDraft,
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
    const accepted = chooseMask(objectDraft, "accept", "cellsam");

    expect(accepted.selectedProposalId).toBe("cellsam");
    expect(canSaveDraft(accepted)).toBe(true);
  });

  it("does not attach a proposal to a rejected mask", () => {
    const objectDraft = chooseObject(emptyDraft, "valid_nucleus");
    const rejected = chooseMask(objectDraft, "reject", "cellsam");

    expect(rejected.selectedProposalId).toBeNull();
    expect(canSaveDraft(rejected)).toBe(true);
  });
});
