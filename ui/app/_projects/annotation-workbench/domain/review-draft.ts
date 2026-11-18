import type {
  MaskDecision,
  ObjectDecision,
  ReviewEvent,
} from "./review-contract";

export type ReviewDraft = Readonly<{
  objectDecision: ObjectDecision | null;
  maskDecision: MaskDecision | null;
  selectedProposalId: string | null;
  notes: string;
}>;

export const emptyDraft: ReviewDraft = {
  objectDecision: null,
  maskDecision: null,
  selectedProposalId: null,
  notes: "",
};

export function draftFromReview(review: ReviewEvent | undefined): ReviewDraft {
  if (!review) return emptyDraft;
  return {
    objectDecision: review.object_decision,
    maskDecision: review.mask_decision,
    selectedProposalId: review.selected_proposal_id ?? null,
    notes: review.notes,
  };
}

export function chooseObject(
  draft: ReviewDraft,
  decision: ObjectDecision,
): ReviewDraft {
  if (decision === "valid_nucleus") {
    return { ...draft, objectDecision: decision, maskDecision: null };
  }
  return {
    ...draft,
    objectDecision: decision,
    maskDecision: "not_applicable",
    selectedProposalId: null,
  };
}

export function chooseMask(
  draft: ReviewDraft,
  decision: Exclude<MaskDecision, "not_applicable">,
  proposalId: string,
): ReviewDraft {
  if (draft.objectDecision !== "valid_nucleus") return draft;
  return {
    ...draft,
    maskDecision: decision,
    selectedProposalId: decision === "reject" ? null : proposalId,
  };
}

export function chooseProposal(
  draft: ReviewDraft,
  proposalId: string,
): ReviewDraft {
  return {
    ...draft,
    objectDecision: "valid_nucleus",
    maskDecision:
      draft.objectDecision === "valid_nucleus" &&
      draft.maskDecision !== "reject"
        ? draft.maskDecision
        : null,
    selectedProposalId: proposalId,
  };
}

export function rejectProposals(draft: ReviewDraft): ReviewDraft {
  if (draft.objectDecision !== "valid_nucleus") return draft;
  return {
    ...draft,
    maskDecision: "reject",
    selectedProposalId: null,
  };
}

export function canSaveDraft(draft: ReviewDraft): boolean {
  if (!draft.objectDecision || !draft.maskDecision) return false;
  if (draft.objectDecision !== "valid_nucleus") {
    return (
      draft.maskDecision === "not_applicable" &&
      draft.selectedProposalId === null
    );
  }
  if (draft.maskDecision === "not_applicable") return false;
  if (draft.maskDecision === "reject") return draft.selectedProposalId === null;
  return draft.selectedProposalId !== null;
}
