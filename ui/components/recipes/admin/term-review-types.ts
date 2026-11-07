import type {
  TermResolutionAction,
  TermReviewQueueItem,
} from "@/lib/api/term-resolution";

export type ResolutionDraft = {
  action: Exclude<TermResolutionAction, "reversal">;
  targetSlug: string;
  canonicalName: string;
  rationale: string;
  localeReview: boolean;
  collisionReview: boolean;
};

export const emptyResolutionDraft: ResolutionDraft = {
  action: "alias",
  targetSlug: "",
  canonicalName: "",
  rationale: "",
  localeReview: false,
  collisionReview: false,
};

export function rankedCandidates(item: TermReviewQueueItem) {
  const candidates = new Map<string, number>();
  for (const context of item.contexts) {
    for (const candidate of context.candidateMatches) {
      candidates.set(
        candidate.slug,
        Math.max(candidate.score, candidates.get(candidate.slug) ?? 0),
      );
    }
  }
  return [...candidates.entries()]
    .sort(
      ([leftSlug, leftScore], [rightSlug, rightScore]) =>
        rightScore - leftScore || leftSlug.localeCompare(rightSlug),
    )
    .map(([slug, score]) => ({ slug, score }));
}

export function resolutionDraftFor(
  item: TermReviewQueueItem | undefined,
): ResolutionDraft {
  if (!item) return emptyResolutionDraft;
  return {
    ...emptyResolutionDraft,
    targetSlug: rankedCandidates(item)[0]?.slug ?? "",
  };
}

export type TermReviewMutation = (
  operation: () => Promise<void>,
  successMessage?: string,
) => Promise<void>;
