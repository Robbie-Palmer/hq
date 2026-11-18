import { describe, expect, it } from "vitest";
import type { ReviewEvent, ReviewItem } from "../domain/review-contract";
import { summarizeReviews } from "../domain/review-summary";

const items = [
  {
    id: "item-1",
    proposals: [
      {
        id: "proposal-1",
        model_name: "CellSAM",
      },
    ],
  },
  {
    id: "item-2",
    proposals: [
      {
        id: "proposal-2",
        model_name: "SAM 2.1",
      },
    ],
  },
  { id: "item-3", proposals: [] },
] as unknown as ReviewItem[];

function review(overrides: Partial<ReviewEvent>): ReviewEvent {
  return {
    reviewer_id: "reviewer-a",
    item_id: "item-1",
    object_decision: "valid_nucleus",
    mask_decision: "accept",
    selected_proposal_id: "proposal-1",
    notes: "",
    ...overrides,
  } as ReviewEvent;
}

describe("review completion summary", () => {
  it("counts decisions and builds a correction queue", () => {
    const summary = summarizeReviews(
      items,
      [
        review({}),
        review({
          item_id: "item-2",
          mask_decision: "refine",
          selected_proposal_id: "proposal-2",
          notes: "Tighten the lower edge",
        }),
        review({
          item_id: "item-3",
          object_decision: "non_nucleus",
          mask_decision: "not_applicable",
          selected_proposal_id: null,
        }),
        review({ reviewer_id: "someone-else" }),
      ],
      "reviewer-a",
    );

    expect(summary).toMatchObject({
      reviewed: 3,
      approved: 1,
      needsCorrection: 1,
      rejected: 0,
      notNuclei: 1,
      unsure: 0,
    });
    expect(summary.proposalSelections).toEqual([
      { name: "CellSAM", count: 1 },
      { name: "SAM 2.1", count: 1 },
    ]);
    expect(summary.correctionQueue).toEqual([
      {
        itemId: "item-2",
        itemIndex: 1,
        proposalName: "SAM 2.1",
        note: "Tighten the lower edge",
        needsNewBoundary: false,
      },
    ]);
  });
});
