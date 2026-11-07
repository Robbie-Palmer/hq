import type {
  TermResolutionAction,
  TermReviewQueueItem,
} from "@/lib/api/term-resolution";

export type ResolutionDraft = {
  action: Exclude<TermResolutionAction, "reversal" | "merge">;
  targetSlug: string;
  canonicalName: string;
  rationale: string;
};

export const emptyResolutionDraft: ResolutionDraft = {
  action: "alias",
  targetSlug: "",
  canonicalName: "",
  rationale: "",
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
  options?: Readonly<{
    offerUndo?: boolean;
    successMessage?: string;
  }>,
) => Promise<void>;
