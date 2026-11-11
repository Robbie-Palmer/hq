"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadReviewSession, saveReview } from "../api/review-service";
import type {
  ReviewEvent,
  ReviewItem,
  ReviewSession,
} from "../domain/review-contract";
import {
  chooseMask,
  chooseObject,
  chooseProposal,
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
import { CompletionSummary } from "./completion-summary";
import { DecisionPanel } from "./decision-panel";
import { ReviewImages } from "./review-images";

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

function connectionButtonLabel(
  settingsReady: boolean,
  loading: boolean,
  serviceIsConfigured: boolean,
): string {
  if (!settingsReady || loading) return "Connecting…";
  return serviceIsConfigured ? "Retry connection" : "Open review batch";
}

function ConnectionPanel({
  serviceIsConfigured,
  serviceUrl,
  settingsReady,
  loading,
  error,
  onServiceUrlChange,
  onConnect,
}: Readonly<{
  serviceIsConfigured: boolean;
  serviceUrl: string;
  settingsReady: boolean;
  loading: boolean;
  error: string | null;
  onServiceUrlChange: (value: string) => void;
  onConnect: () => void;
}>) {
  return (
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-muted/20 p-4">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <Badge variant="outline">
            {serviceIsConfigured ? "Configured service" : "Local development"}
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">
            Annotation Workbench
          </h1>
          <p className="text-sm text-muted-foreground">
            {serviceIsConfigured
              ? "Opening the review batch configured by the launcher."
              : "Connect to a local review service."}
          </p>
        </div>
        {serviceIsConfigured ? null : (
          <label
            htmlFor="review-service-url"
            className="grid gap-2 text-sm font-medium"
          >
            Review service URL
            <Input
              id="review-service-url"
              value={serviceUrl}
              onChange={(event) => onServiceUrlChange(event.target.value)}
            />
          </label>
        )}
        {error ? (
          <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          className="w-full"
          disabled={loading || !settingsReady}
          onClick={onConnect}
        >
          <Database aria-hidden />
          {connectionButtonLabel(settingsReady, loading, serviceIsConfigured)}
        </Button>
      </div>
    </main>
  );
}

function ReviewNavigation({
  currentIndex,
  totalItems,
  completedItems,
  onPrevious,
  onNext,
}: Readonly<{
  currentIndex: number;
  totalItems: number;
  completedItems: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <nav
      className="sticky top-0 z-30 flex min-w-0 items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
      aria-label="Review item navigation"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={currentIndex === 0}
        onClick={onPrevious}
      >
        <ChevronLeft aria-label="Previous item" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            Item {currentIndex + 1} of {totalItems}
          </span>
          <span className="text-xs text-muted-foreground">
            {completedItems} reviewed
          </span>
        </div>
        <progress
          className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted [appearance:none] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
          max={totalItems}
          value={completedItems}
          aria-label="Review progress"
        />
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={currentIndex === totalItems - 1}
        onClick={onNext}
      >
        <ChevronRight aria-label="Next item" />
      </Button>
    </nav>
  );
}

function TechnicalDetails({
  session,
  item,
}: Readonly<{ session: ReviewSession; item: ReviewItem }>) {
  const licenses = item.proposals
    .map((proposal) => `${proposal.model_name}: ${proposal.model_license}`)
    .join(" · ");
  return (
    <details className="min-w-0 rounded-xl border bg-card px-4 py-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Technical details
      </summary>
      <dl className="mt-3 grid min-w-0 gap-3 text-muted-foreground sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Item</dt>
          <dd className="break-all font-mono">{item.id}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Dataset context</dt>
          <dd>
            {item.context.class_name}, site {item.context.site_id},{" "}
            {item.context.split}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Source box</dt>
          <dd className="break-words font-mono">
            [{item.context.bbox_xyxy.join(", ")}] ·{" "}
            {item.context.coordinate_space}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Producer</dt>
          <dd className="break-words">{session.bundle.provenance.producer}</dd>
          <dd className="break-all font-mono">
            {session.bundle.provenance.producer_revision.slice(0, 12)}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-medium text-foreground">Model licenses</dt>
          <dd className="break-words">{licenses}</dd>
        </div>
      </dl>
    </details>
  );
}

export function AnnotationWorkbench() {
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

  const reviewerIdIsValid = REVIEWER_ID_PATTERN.test(reviewerId);
  const completedItems = session
    ? new Set(
        session.latest_reviews
          .filter((review) => review.reviewer_id === reviewerId)
          .map((review) => review.item_id),
      )
    : new Set<string>();
  const reviewSummary = session
    ? summarizeReviews(session.bundle.items, session.latest_reviews, reviewerId)
    : null;

  useEffect(() => {
    if (!session) return;
    const reviewedItemIds = new Set(
      session.latest_reviews
        .filter((review) => review.reviewer_id === reviewerId)
        .map((review) => review.item_id),
    );
    setShowCompletion(reviewedItemIds.size === session.bundle.items.length);
  }, [reviewerId, session]);

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
      setSession({ ...session, latest_reviews: latestReviews });
      const reviewedItemIds = new Set(
        latestReviews
          .filter((review) => review.reviewer_id === reviewerId)
          .map((review) => review.item_id),
      );
      if (reviewedItemIds.size === session.bundle.items.length) {
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

  if (!session || !item) {
    return (
      <ConnectionPanel
        serviceIsConfigured={serviceIsConfigured}
        serviceUrl={serviceUrl}
        settingsReady={settingsReady}
        loading={loading}
        error={error}
        onServiceUrlChange={setServiceUrl}
        onConnect={() => {
          persistIdentity();
          void connect();
        }}
      />
    );
  }

  return (
    <main className="min-h-dvh w-full max-w-full overflow-x-hidden bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
          <h1 className="mr-auto font-semibold">Annotation Workbench</h1>
          <label
            htmlFor="annotation-reviewer-name"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            Reviewer
            <Input
              id="annotation-reviewer-name"
              aria-label="Reviewer name"
              aria-invalid={!reviewerIdIsValid}
              className="h-8 w-32"
              value={reviewerId}
              onChange={(event) => setReviewerId(event.target.value)}
              onBlur={persistIdentity}
            />
          </label>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void connect()}
          >
            <RefreshCw aria-label="Reload review batch" />
          </Button>
        </div>
      </header>

      {showCompletion && reviewSummary ? (
        <CompletionSummary
          summary={reviewSummary}
          totalItems={session.bundle.items.length}
          onOpenItem={(index) => {
            setCurrentIndex(index);
            setShowCompletion(false);
          }}
        />
      ) : (
        <div className="mx-auto w-full max-w-7xl min-w-0 space-y-3 p-3 sm:p-4">
          <ReviewNavigation
            currentIndex={currentIndex}
            totalItems={session.bundle.items.length}
            completedItems={completedItems.size}
            onPrevious={() =>
              setCurrentIndex((index) => Math.max(0, index - 1))
            }
            onNext={() =>
              setCurrentIndex((index) =>
                Math.min(session.bundle.items.length - 1, index + 1),
              )
            }
          />

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <ReviewImages
              serviceUrl={serviceUrl}
              session={session}
              item={item}
              proposals={item.proposals}
              selectedProposalId={draft.selectedProposalId}
              opacity={opacity}
              showReference={showReference}
              onSelectProposal={(proposalId) =>
                setDraft((current) => chooseProposal(current, proposalId))
              }
              onOpacityChange={setOpacity}
              onReferenceChange={() => setShowReference((visible) => !visible)}
            />

            <aside className="min-w-0 space-y-3">
              <DecisionPanel
                draft={draft}
                proposals={item.proposals}
                saving={saving}
                saveLabel={
                  currentReview
                    ? "Save changes"
                    : completedItems.size === session.bundle.items.length - 1
                      ? "Save and finish"
                      : "Save and next"
                }
                reviewerIdIsValid={reviewerIdIsValid}
                onChange={setDraft}
                onSave={() => void submitReview()}
              />
              {error ? (
                <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}
            </aside>
          </div>

          <TechnicalDetails session={session} item={item} />
        </div>
      )}
    </main>
  );
}
