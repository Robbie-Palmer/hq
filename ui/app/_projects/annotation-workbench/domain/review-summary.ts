import type { ReviewEvent, ReviewItem } from "./review-contract";

export type CorrectionQueueItem = Readonly<{
  itemId: string;
  itemIndex: number;
  proposalName: string | null;
  note: string;
  needsNewBoundary: boolean;
}>;

export type ReviewSummary = Readonly<{
  reviewed: number;
  approved: number;
  needsCorrection: number;
  rejected: number;
  notNuclei: number;
  unsure: number;
  proposalSelections: readonly Readonly<{ name: string; count: number }>[];
  correctionQueue: readonly CorrectionQueueItem[];
}>;

export function summarizeReviews(
  items: readonly ReviewItem[],
  latestReviews: readonly ReviewEvent[],
  reviewerId: string,
): ReviewSummary {
  const itemIndexes = new Map(
    items.map((item, index) => [item.id, index] as const),
  );
  const reviews = latestReviews.filter(
    (review) =>
      review.reviewer_id === reviewerId && itemIndexes.has(review.item_id),
  );
  const proposalSelections = new Map<string, number>();
  const correctionQueue: CorrectionQueueItem[] = [];

  for (const review of reviews) {
    const itemIndex = itemIndexes.get(review.item_id);
    if (itemIndex === undefined) continue;
    const item = items[itemIndex];
    const proposal = item?.proposals.find(
      (candidate) => candidate.id === review.selected_proposal_id,
    );
    if (proposal) {
      proposalSelections.set(
        proposal.model_name,
        (proposalSelections.get(proposal.model_name) ?? 0) + 1,
      );
    }
    if (
      review.mask_decision === "refine" ||
      review.mask_decision === "reject"
    ) {
      correctionQueue.push({
        itemId: review.item_id,
        itemIndex,
        proposalName: proposal?.model_name ?? null,
        note: review.notes,
        needsNewBoundary: review.mask_decision === "reject",
      });
    }
  }

  return {
    reviewed: reviews.length,
    approved: reviews.filter((review) => review.mask_decision === "accept")
      .length,
    needsCorrection: reviews.filter(
      (review) => review.mask_decision === "refine",
    ).length,
    rejected: reviews.filter((review) => review.mask_decision === "reject")
      .length,
    notNuclei: reviews.filter(
      (review) => review.object_decision === "non_nucleus",
    ).length,
    unsure: reviews.filter((review) => review.object_decision === "uncertain")
      .length,
    proposalSelections: Array.from(proposalSelections, ([name, count]) => ({
      name,
      count,
    })).sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name),
    ),
    correctionQueue,
  };
}
