import type { TermResolutionAction } from "@/lib/api/term-resolution";

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

export type TermReviewMutation = (
  operation: () => Promise<void>,
) => Promise<void>;
