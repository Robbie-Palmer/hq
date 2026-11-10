"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/generic/styles";
import { loadReviewSession, saveReview } from "../api/review-service";
import type {
  ReviewEvent,
  ReviewerKind,
  ReviewSession,
} from "../domain/review-contract";
import {
  chooseMask,
  chooseObject,
  draftFromReview,
  type ReviewDraft,
} from "../domain/review-draft";
import {
  inferReviewServiceUrl,
  LOOPBACK_SERVICE_URL,
} from "../domain/service-url";
import { DecisionPanel } from "./decision-panel";
import { ReviewImages } from "./review-images";

const REVIEWER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function persistWorkbenchSettings(serviceUrl: string, reviewerId: string) {
  window.localStorage.setItem("annotation-workbench:service-url", serviceUrl);
  if (REVIEWER_ID_PATTERN.test(reviewerId)) {
    window.localStorage.setItem("annotation-workbench:reviewer-id", reviewerId);
  }
}

function shortcutDraft(
  key: string,
  draft: ReviewDraft,
  proposalId: string,
): ReviewDraft | undefined {
  const actions: Readonly<Record<string, () => ReviewDraft>> = {
    "1": () => chooseObject(draft, "valid_nucleus"),
    "2": () => chooseObject(draft, "non_nucleus"),
    "3": () => chooseObject(draft, "uncertain"),
    a: () => chooseMask(draft, "accept", proposalId),
    f: () => chooseMask(draft, "refine", proposalId),
    r: () => chooseMask(draft, "reject", proposalId),
  };
  return actions[key.toLowerCase()]?.();
}

function useReviewShortcuts(
  draft: ReviewDraft,
  proposalId: string | undefined,
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
      if (!enabled || editing || !proposalId) return;
      const nextDraft = shortcutDraft(event.key, draft, proposalId);
      if (!nextDraft) return;
      onChange(nextDraft);
      event.preventDefault();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [draft, enabled, onChange, proposalId]);
}

function ReferenceToggle({
  available,
  visible,
  onChange,
}: Readonly<{
  available: boolean;
  visible: boolean;
  onChange: () => void;
}>) {
  if (!available) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant={visible ? "secondary" : "ghost"}
      className="ml-auto"
      aria-pressed={visible}
      onClick={onChange}
    >
      {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      {visible ? "Hide" : "Show"} source reference
    </Button>
  );
}

export function AnnotationWorkbench() {
  const [serviceUrl, setServiceUrl] = useState(LOOPBACK_SERVICE_URL);
  const [reviewerId, setReviewerId] = useState("reviewer-a");
  const [reviewerKind, setReviewerKind] = useState<ReviewerKind>("human");
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>(draftFromReview(undefined));
  const [opacity, setOpacity] = useState(100);
  const [showReference, setShowReference] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setServiceUrl(storedUrl ?? inferReviewServiceUrl(window.location.hostname));
    if (storedReviewer) setReviewerId(storedReviewer);
  }, []);

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
    const primary =
      item.proposals.find((proposal) => proposal.role === "primary") ??
      item.proposals[0];
    setProposalId(currentReview?.selected_proposal_id ?? primary?.id ?? null);
    setDraft(draftFromReview(currentReview));
    setShowReference(false);
  }, [currentReview, item]);

  const proposal =
    item?.proposals.find((candidate) => candidate.id === proposalId) ??
    item?.proposals[0];
  const reviewerIdIsValid = REVIEWER_ID_PATTERN.test(reviewerId);
  const completedItems = session
    ? new Set(
        session.latest_reviews
          .filter((review) => review.reviewer_id === reviewerId)
          .map((review) => review.item_id),
      )
    : new Set<string>();

  async function submitReview() {
    if (!session || !item || !draft.objectDecision || !draft.maskDecision)
      return;
    setSaving(true);
    setError(null);
    const event: ReviewEvent = {
      schema_version: "1.0.0",
      event_id: crypto.randomUUID(),
      batch_id: session.bundle.batch_id,
      item_id: item.id,
      reviewer_id: reviewerId,
      reviewer_kind: reviewerKind,
      created_at: new Date().toISOString(),
      supersedes_event_id: currentReview?.event_id ?? null,
      object_decision: draft.objectDecision,
      mask_decision: draft.maskDecision,
      selected_proposal_id: draft.selectedProposalId,
      notes: draft.notes,
    };
    try {
      const saved = await saveReview(serviceUrl, event);
      setSession((current) =>
        current
          ? {
              ...current,
              latest_reviews: [
                ...current.latest_reviews.filter(
                  (review) =>
                    review.item_id !== saved.item_id ||
                    review.reviewer_id !== saved.reviewer_id,
                ),
                saved,
              ],
            }
          : current,
      );
      setCurrentIndex((index) =>
        Math.min(index + 1, session.bundle.items.length - 1),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Review could not be saved",
      );
    } finally {
      setSaving(false);
    }
  }

  function persistIdentity() {
    persistWorkbenchSettings(serviceUrl, reviewerId);
  }

  useReviewShortcuts(draft, proposal?.id, Boolean(item), setDraft);

  if (!session || !item || !proposal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <div className="w-full max-w-lg space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <Badge variant="outline">Local-first</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">
              Annotation Workbench
            </h1>
            <p className="text-sm text-muted-foreground">
              Connect to a local or tailnet review service. Source images and
              review records remain on the serving machine.
            </p>
          </div>
          <label
            htmlFor="review-service-url"
            className="grid gap-2 text-sm font-medium"
          >
            Review service URL
            <Input
              id="review-service-url"
              value={serviceUrl}
              onChange={(event) => setServiceUrl(event.target.value)}
            />
          </label>
          {error ? (
            <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={loading}
            onClick={() => {
              persistIdentity();
              void connect();
            }}
          >
            <Database aria-hidden />
            {loading ? "Connecting…" : "Open review batch"}
          </Button>
          <p className="font-mono text-xs text-muted-foreground">
            {"mise //ml-pipelines/annotation-workbench-service:serve -- "}
            {"--bundle=/path/bundle.json"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-muted/20">
      <header className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3">
        <div className="mr-auto">
          <h1 className="font-semibold">Annotation Workbench</h1>
          <p className="text-xs text-muted-foreground">
            {session.bundle.batch_id}
          </p>
        </div>
        <Input
          aria-label="Reviewer ID"
          aria-invalid={!reviewerIdIsValid}
          className="h-8 w-full sm:w-40"
          value={reviewerId}
          onChange={(event) => setReviewerId(event.target.value)}
          onBlur={persistIdentity}
        />
        <div className="flex rounded-md border p-0.5">
          {(["human", "assistant"] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={reviewerKind === kind ? "secondary" : "ghost"}
              className="h-7 capitalize"
              onClick={() => setReviewerKind(kind)}
            >
              {kind}
            </Button>
          ))}
        </div>
        <Badge variant="outline">
          {completedItems.size}/{session.bundle.items.length} reviewed
        </Badge>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => void connect()}
        >
          <RefreshCw aria-label="Reload review batch" />
        </Button>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <aside className="max-w-full overflow-x-auto rounded-xl border bg-card p-2 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
          <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Review queue
          </div>
          <div className="flex gap-1 lg:grid">
            {session.bundle.items.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                className={cn(
                  "flex min-w-40 items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent lg:min-w-0",
                  index === currentIndex && "bg-accent font-medium",
                )}
                onClick={() => setCurrentIndex(index)}
              >
                <span className="truncate">{candidate.id}</span>
                <span
                  className={cn(
                    "size-2 rounded-full bg-muted-foreground/30",
                    completedItems.has(candidate.id) && "bg-primary",
                  )}
                  aria-hidden
                />
                <span className="sr-only">
                  {completedItems.has(candidate.id)
                    ? "Reviewed"
                    : "Not reviewed"}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="mr-auto">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{item.id}</h2>
                <Badge variant="secondary">{item.context.class_name}</Badge>
                <Badge variant="outline">site {item.context.site_id}</Badge>
                <Badge variant="outline">{item.context.split}</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                box [{item.context.bbox_xyxy.join(", ")}] ·{" "}
                {item.context.coordinate_space}
              </p>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            >
              <ChevronLeft aria-label="Previous item" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={currentIndex === session.bundle.items.length - 1}
              onClick={() =>
                setCurrentIndex((index) =>
                  Math.min(session.bundle.items.length - 1, index + 1),
                )
              }
            >
              <ChevronRight aria-label="Next item" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {item.proposals.map((candidate) => (
              <Button
                key={candidate.id}
                type="button"
                size="sm"
                variant={candidate.id === proposal.id ? "default" : "outline"}
                onClick={() => {
                  setProposalId(candidate.id);
                  if (
                    draft.maskDecision === "accept" ||
                    draft.maskDecision === "refine"
                  ) {
                    setDraft({ ...draft, selectedProposalId: candidate.id });
                  }
                }}
              >
                {candidate.model_name}
                <span className="text-xs opacity-60">{candidate.role}</span>
              </Button>
            ))}
            <ReferenceToggle
              available={Boolean(item.reference_asset_id)}
              visible={showReference}
              onChange={() => setShowReference((visible) => !visible)}
            />
          </div>

          <ReviewImages
            serviceUrl={serviceUrl}
            session={session}
            item={item}
            proposal={proposal}
            opacity={opacity}
            showReference={showReference}
            onOpacityChange={setOpacity}
          />
        </section>

        <aside className="space-y-4">
          <DecisionPanel
            draft={draft}
            proposals={item.proposals}
            selectedProposal={proposal}
            saving={saving}
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
          <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Provenance</p>
            <p className="mt-2">{session.bundle.provenance.producer}</p>
            <p className="font-mono">
              {session.bundle.provenance.producer_revision.slice(0, 12)}
            </p>
            <p className="mt-2">{proposal.model_license}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
