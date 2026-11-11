import { useCallback, useEffect, useMemo, useState } from "react";
import { loadReviewSession, saveReview } from "../api/review-service";
import type { ReviewEvent, ReviewSession } from "../domain/review-contract";
import {
  chooseMask,
  chooseObject,
  draftFromReview,
  type ReviewDraft,
  rejectProposals,
} from "../domain/review-draft";
import { createReviewEventId } from "../domain/review-event-id";
import { summarizeReviews } from "../domain/review-summary";
import {
  LOOPBACK_SERVICE_URL,
  resolveReviewServiceUrl,
} from "../domain/service-url";

const REVIEWER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONFIGURED_SERVICE_URL =
  process.env.NEXT_PUBLIC_ANNOTATION_WORKBENCH_SERVICE_URL?.trim() || undefined;

function persistWorkbenchSettings(
  serviceUrl: string,
  reviewerId: string,
  persistServiceUrl: boolean,
) {
  if (persistServiceUrl) {
    window.localStorage.setItem("annotation-workbench:service-url", serviceUrl);
  }
  if (REVIEWER_ID_PATTERN.test(reviewerId)) {
    window.localStorage.setItem("annotation-workbench:reviewer-id", reviewerId);
  }
}

function shortcutDraft(
  key: string,
  draft: ReviewDraft,
): ReviewDraft | undefined {
  switch (key.toLowerCase()) {
    case "1":
      return chooseObject(draft, "valid_nucleus");
    case "2":
      return chooseObject(draft, "non_nucleus");
    case "3":
      return chooseObject(draft, "uncertain");
    case "a":
      return draft.selectedProposalId
        ? chooseMask(draft, "accept", draft.selectedProposalId)
        : undefined;
    case "f":
      return draft.selectedProposalId
        ? chooseMask(draft, "refine", draft.selectedProposalId)
        : undefined;
    case "r":
      return rejectProposals(draft);
    default:
      return undefined;
  }
}

function useReviewShortcuts(
  draft: ReviewDraft,
  enabled: boolean,
  onChange: (draft: ReviewDraft) => void,
) {
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (!enabled || editing) return;
      const nextDraft = shortcutDraft(event.key, draft);
      if (!nextDraft || nextDraft === draft) return;
      onChange(nextDraft);
      event.preventDefault();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [draft, enabled, onChange]);
}

function reviewedItemIds(session: ReviewSession, reviewerId: string) {
  return new Set(
    session.latest_reviews
      .filter((review) => review.reviewer_id === reviewerId)
      .map((review) => review.item_id),
  );
}

export function useAnnotationWorkbench() {
  const [serviceUrl, setServiceUrl] = useState(LOOPBACK_SERVICE_URL);
  const [reviewerId, setReviewerId] = useState("reviewer-a");
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draft, setDraft] = useState<ReviewDraft>(draftFromReview(undefined));
  const [opacity, setOpacity] = useState(100);
  const [showReference, setShowReference] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const serviceIsConfigured = CONFIGURED_SERVICE_URL !== undefined;

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadReviewSession(serviceUrl);
      setSession(loaded);
      setCurrentIndex(0);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reach the review service",
      );
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [serviceUrl]);

  useEffect(() => {
    const storedUrl = window.localStorage.getItem(
      "annotation-workbench:service-url",
    );
    const storedReviewer = window.localStorage.getItem(
      "annotation-workbench:reviewer-id",
    );
    setServiceUrl(
      resolveReviewServiceUrl({
        configuredUrl: CONFIGURED_SERVICE_URL,
        storedUrl: storedUrl ?? undefined,
        hostname: window.location.hostname,
      }),
    );
    if (storedReviewer) setReviewerId(storedReviewer);
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!settingsReady || !serviceIsConfigured) return;
    void connect();
  }, [connect, serviceIsConfigured, settingsReady]);

  const item = session?.bundle.items[currentIndex];
  const currentReview = useMemo(
    () =>
      item
        ? session?.latest_reviews.find(
            (review) =>
              review.item_id === item.id && review.reviewer_id === reviewerId,
          )
        : undefined,
    [item, reviewerId, session?.latest_reviews],
  );

  useEffect(() => {
    if (!item) return;
    setDraft(draftFromReview(currentReview));
    setShowReference(false);
  }, [currentReview, item]);

  useEffect(() => {
    if (!session) return;
    setShowCompletion(
      reviewedItemIds(session, reviewerId).size === session.bundle.items.length,
    );
  }, [reviewerId, session]);

  const completedItems = session
    ? reviewedItemIds(session, reviewerId)
    : new Set<string>();
  const reviewSummary = session
    ? summarizeReviews(session.bundle.items, session.latest_reviews, reviewerId)
    : null;
  const reviewerIdIsValid = REVIEWER_ID_PATTERN.test(reviewerId);

  async function submitReview() {
    if (!session || !item || !draft.objectDecision || !draft.maskDecision)
      return;
    setSaving(true);
    setError(null);
    const event: ReviewEvent = {
      schema_version: "1.0.0",
      event_id: createReviewEventId(),
      batch_id: session.bundle.batch_id,
      item_id: item.id,
      reviewer_id: reviewerId,
      reviewer_kind: "human",
      created_at: new Date().toISOString(),
      supersedes_event_id: currentReview?.event_id ?? null,
      object_decision: draft.objectDecision,
      mask_decision: draft.maskDecision,
      selected_proposal_id: draft.selectedProposalId,
      notes: draft.notes,
    };
    try {
      const saved = await saveReview(serviceUrl, event);
      const latestReviews = [
        ...session.latest_reviews.filter(
          (review) =>
            review.item_id !== saved.item_id ||
            review.reviewer_id !== saved.reviewer_id,
        ),
        saved,
      ];
      const nextSession = { ...session, latest_reviews: latestReviews };
      setSession(nextSession);
      if (
        reviewedItemIds(nextSession, reviewerId).size ===
        session.bundle.items.length
      ) {
        setShowCompletion(true);
      } else {
        setCurrentIndex((index) =>
          Math.min(index + 1, session.bundle.items.length - 1),
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Review could not be saved",
      );
    } finally {
      setSaving(false);
    }
  }

  function persistIdentity() {
    persistWorkbenchSettings(serviceUrl, reviewerId, !serviceIsConfigured);
  }

  useReviewShortcuts(draft, Boolean(item) && !showCompletion, setDraft);

  return {
    serviceUrl,
    setServiceUrl,
    reviewerId,
    setReviewerId,
    session,
    currentIndex,
    setCurrentIndex,
    draft,
    setDraft,
    opacity,
    setOpacity,
    showReference,
    setShowReference,
    loading,
    saving,
    showCompletion,
    setShowCompletion,
    error,
    settingsReady,
    serviceIsConfigured,
    connect,
    persistIdentity,
    submitReview,
    item,
    currentReview,
    completedItems,
    reviewSummary,
    reviewerIdIsValid,
  };
}
