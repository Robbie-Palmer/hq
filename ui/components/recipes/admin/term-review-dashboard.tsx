"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  loadTermResolutionAudit,
  loadTermReviewQueue,
  reverseTermResolution,
  submitTermResolution,
  type TermResolutionAuditItem,
  type TermReviewQueueItem,
} from "@/lib/api/term-resolution";
import { authClient } from "@/lib/auth-client";
import { TermResolutionAudit } from "./term-resolution-audit";
import { TermResolutionForm } from "./term-resolution-form";
import { TermReviewEvidence } from "./term-review-evidence";
import {
  emptyResolutionDraft,
  type ResolutionDraft,
  resolutionDraftFor,
  type TermReviewMutation,
} from "./term-review-types";

function useTermReviewData(enabled: boolean) {
  const [queue, setQueue] = useState<TermReviewQueueItem[]>([]);
  const [audit, setAudit] = useState<TermResolutionAuditItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(emptyResolutionDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [undoDecision, setUndoDecision] =
    useState<TermResolutionAuditItem | null>(null);
  const refresh = useCallback(async () => {
    const [nextQueue, nextAudit] = await Promise.all([
      loadTermReviewQueue(),
      loadTermResolutionAudit(),
    ]);
    setQueue(nextQueue);
    setAudit(nextAudit);
    setSelected((index) => Math.min(index, Math.max(nextQueue.length - 1, 0)));
    return { nextAudit, nextQueue };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    setPending(true);
    refresh()
      .then(({ nextQueue }) => setDraft(resolutionDraftFor(nextQueue[0])))
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load term review.",
        ),
      )
      .finally(() => setPending(false));
  }, [enabled, refresh]);
  const mutate: TermReviewMutation = async (operation, options) => {
    setPending(true);
    setError(null);
    setStatus("");
    setUndoDecision(null);
    try {
      await operation();
      const previousDecisionIds = new Set(audit.map(({ id }) => id));
      const { nextAudit } = await refresh();
      setSelected(0);
      setDraft(emptyResolutionDraft);
      if (options?.offerUndo) {
        setUndoDecision(
          nextAudit.find(
            ({ action, id }) =>
              action !== "reversal" && !previousDecisionIds.has(id),
          ) ?? null,
        );
      }
      setStatus(options?.successMessage ?? "Action completed.");
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Could not save the decision.",
      );
    } finally {
      setPending(false);
    }
  };
  return {
    audit,
    draft,
    error,
    mutate,
    pending,
    queue,
    selected,
    setDraft,
    setSelected,
    status,
    undoDecision,
  };
}

function DashboardHeader() {
  return (
    <header>
      <p className="rt-mono text-xs tracking-wide text-[var(--terracotta-deep)] uppercase">
        Administrator workflow
      </p>
      <h1 className="rt-display text-4xl sm:text-5xl">
        Unresolved term review
      </h1>
      <p className="mt-2 max-w-3xl rt-body text-[var(--ink-3)]">
        Repeated submissions come first. Match an existing item, create a new
        one, remove noise, or skip it for later. The source evidence stays
        available and every decision is audited.
      </p>
    </header>
  );
}

function ReviewQueue({
  queue,
  selected,
  select,
}: Readonly<{
  queue: TermReviewQueueItem[];
  selected: number;
  select: (index: number) => void;
}>) {
  return (
    <nav aria-label="Unresolved terms" className="space-y-2">
      {queue.map((term, index) => (
        <button
          key={`${term.kind}:${term.normalizedText}:${term.locale}`}
          type="button"
          aria-current={index === selected ? "true" : undefined}
          className="w-full rounded-lg border border-[var(--line)] p-3 text-left aria-[current=true]:border-[var(--terracotta)] aria-[current=true]:bg-[var(--paper-warm)]"
          onClick={() => select(index)}
        >
          <span className="block rt-body font-medium">{term.rawTexts[0]}</span>
          <span className="block rt-mono text-xs text-[var(--ink-3)]">
            {term.submissionCount} submissions · {term.tenantCount} accounts
          </span>
        </button>
      ))}
    </nav>
  );
}

function resolutionSuccessMessage(action: ResolutionDraft["action"]): string {
  if (action === "defer") {
    return "Skipped for later. It moved to the deferred queue with all evidence intact.";
  }
  if (action === "reject") {
    return "Removed from the review queue. You can undo this now or reverse it from the audit log.";
  }
  return "Saved. The next term is ready.";
}

function defaultRationale(
  action: ResolutionDraft["action"],
  targetSlug: string,
) {
  if (action === "alias") return `Matched to ${targetSlug}.`;
  if (action === "new_canonical")
    return `Created canonical item ${targetSlug}.`;
  if (action === "defer") return "Skipped for later review.";
  return "Marked as not a structured term.";
}

function reviewCommand(
  item: TermReviewQueueItem,
  draft: ResolutionDraft,
  action = draft.action,
) {
  const requiresExplicitReview = action !== "defer";
  return {
    action,
    idempotencyKey: crypto.randomUUID(),
    rationale:
      draft.rationale.trim() || defaultRationale(action, draft.targetSlug),
    expectedRegistryVersion: item.registryVersion,
    evidence: item.contexts.flatMap((context) =>
      context.candidateMatches.map(
        (candidate) => `${candidate.slug}:${candidate.score.toFixed(4)}`,
      ),
    ),
    localeReview: requiresExplicitReview && item.localeReviewRequired,
    collisionReview: requiresExplicitReview && item.collisionReviewRequired,
    ...(["alias", "new_canonical"].includes(action)
      ? { targetSlug: draft.targetSlug }
      : {}),
    ...(action === "new_canonical"
      ? { canonicalName: draft.canonicalName }
      : {}),
  };
}

function ReviewCardHeader({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="rt-mono text-xs text-[var(--ink-3)]">
          {item.kind} · {item.locale}
        </p>
        <h2 className="rt-display text-3xl">{item.rawTexts[0]}</h2>
        <p className="rt-mono text-sm text-[var(--ink-3)]">
          normalized as {item.normalizedText}
        </p>
      </div>
      <p className="rounded-full bg-[var(--paper-warm)] px-3 py-1 rt-mono text-xs">
        {item.submissionCount} submissions
      </p>
    </div>
  );
}

function ReviewCard({
  deferred,
  draft,
  item,
  mutate,
  pending,
  setDraft,
}: Readonly<{
  deferred: boolean;
  draft: ResolutionDraft;
  item: TermReviewQueueItem;
  mutate: TermReviewMutation;
  pending: boolean;
  setDraft: (draft: ResolutionDraft) => void;
}>) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 sm:p-6">
      <ReviewCardHeader item={item} />
      <div className="mt-6">
        <TermReviewEvidence
          item={item}
          selectedSlug={draft.targetSlug}
          selectCandidate={(targetSlug) =>
            setDraft({ ...draft, action: "alias", targetSlug })
          }
        />
      </div>
      <TermResolutionForm
        deferred={deferred}
        draft={draft}
        item={item}
        pending={pending}
        setDraft={setDraft}
        submit={(action = draft.action) =>
          mutate(
            () =>
              submitTermResolution({
                target: item,
                command: reviewCommand(item, draft, action),
              }),
            {
              offerUndo: true,
              successMessage: resolutionSuccessMessage(action),
            },
          )
        }
      />
    </article>
  );
}

function ReviewWorkspace({
  data,
  deferred,
  queue,
}: Readonly<{
  data: ReturnType<typeof useTermReviewData>;
  deferred: boolean;
  queue: TermReviewQueueItem[];
}>) {
  const item = queue[data.selected];
  useEffect(() => {
    data.setDraft(resolutionDraftFor(item));
  }, [data.setDraft, item]);
  if (!item) {
    return data.pending ? null : (
      <p className="mt-8 rounded-xl border border-[var(--line)] p-6 rt-body">
        {deferred
          ? "No terms have been skipped for later."
          : "No terms are waiting for review."}
      </p>
    );
  }
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
      <ReviewQueue
        queue={queue}
        selected={data.selected}
        select={(index) => {
          data.setSelected(index);
          data.setDraft(resolutionDraftFor(queue[index]));
        }}
      />
      <ReviewCard
        deferred={deferred}
        draft={data.draft}
        item={item}
        mutate={data.mutate}
        pending={data.pending}
        setDraft={data.setDraft}
      />
    </div>
  );
}

function QueueFilters({
  activeCount,
  deferredCount,
  deferred,
  setDeferred,
}: Readonly<{
  activeCount: number;
  deferredCount: number;
  deferred: boolean;
  setDeferred: (deferred: boolean) => void;
}>) {
  return (
    <fieldset className="mt-6 flex gap-2">
      <legend className="sr-only">Review queue</legend>
      <Button
        type="button"
        variant={deferred ? "outline" : "default"}
        aria-pressed={!deferred}
        onClick={() => setDeferred(false)}
      >
        Needs review ({activeCount})
      </Button>
      <Button
        type="button"
        variant={deferred ? "default" : "outline"}
        aria-pressed={deferred}
        onClick={() => setDeferred(true)}
      >
        Later ({deferredCount})
      </Button>
    </fieldset>
  );
}

function ReviewStatus({
  data,
}: Readonly<{ data: ReturnType<typeof useTermReviewData> }>) {
  const undoDecision = data.undoDecision;
  return (
    <div
      aria-live="polite"
      className="mt-4 flex min-h-9 flex-wrap items-center gap-3 rt-body"
    >
      {data.pending && <span>Working…</span>}
      {data.status && <span>{data.status}</span>}
      {undoDecision && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={data.pending}
          onClick={() =>
            void data.mutate(
              () =>
                reverseTermResolution(
                  undoDecision,
                  "Reviewer undid the previous decision.",
                ),
              { successMessage: "Undone. The term is back in review." },
            )
          }
        >
          Undo last decision
        </Button>
      )}
    </div>
  );
}

function AdminDashboard() {
  const data = useTermReviewData(true);
  const [deferred, setDeferred] = useState(false);
  const deferredQueue = data.queue.filter(
    ({ resolutionStatus }) => resolutionStatus === "deferred",
  );
  const activeQueue = data.queue.filter(
    ({ resolutionStatus }) => resolutionStatus === "unresolved",
  );
  const selectQueue = (showDeferred: boolean) => {
    data.setSelected(0);
    setDeferred(showDeferred);
  };
  return (
    <main className="container mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <DashboardHeader />
      <ReviewStatus data={data} />
      {data.error && (
        <p role="alert" className="mt-2 rt-body text-[var(--berry)]">
          {data.error}
        </p>
      )}
      <QueueFilters
        activeCount={activeQueue.length}
        deferredCount={deferredQueue.length}
        deferred={deferred}
        setDeferred={selectQueue}
      />
      <ReviewWorkspace
        data={data}
        deferred={deferred}
        queue={deferred ? deferredQueue : activeQueue}
      />
      <TermResolutionAudit
        items={data.audit}
        mutate={data.mutate}
        pending={data.pending}
      />
    </main>
  );
}

export function TermReviewDashboard() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <output aria-live="polite">Loading reviewer access…</output>
      </main>
    );
  }
  if (session?.user.role !== "admin") {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="rt-display text-4xl">Term review</h1>
        <p role="alert" className="mt-4 rt-body text-[var(--berry)]">
          Administrator access is required to review terms across accounts.
        </p>
      </main>
    );
  }
  return <AdminDashboard />;
}
