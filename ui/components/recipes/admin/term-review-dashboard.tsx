"use client";

import {
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
  rankedCandidates,
  resolutionDraftFor,
  type TermReviewMutation,
} from "./term-review-types";

function queueItemKey(item: TermReviewQueueItem): string {
  return `${item.kind}:${item.normalizedText}:${item.locale}`;
}

function resultRegistryVersion(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("decision" in result)) {
    return undefined;
  }
  const decision = result.decision;
  if (
    !decision ||
    typeof decision !== "object" ||
    !("registryVersion" in decision)
  ) {
    return undefined;
  }
  return typeof decision.registryVersion === "number"
    ? decision.registryVersion
    : undefined;
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function scheduleOptimisticAdvance(
  target: TermReviewQueueItem | undefined,
  delay: number,
  advance: (target: TermReviewQueueItem) => void,
  restore: (target: TermReviewQueueItem) => void,
) {
  let applied = false;
  let ready = false;
  let markReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    markReady = () => {
      if (ready) return;
      ready = true;
      resolve();
    };
  });
  const apply = () => {
    if (!target) return;
    applied = true;
    advance(target);
    markReady();
  };
  let timer: number | undefined;
  if (target) {
    if (delay === 0) apply();
    else timer = window.setTimeout(apply, delay);
  } else markReady();
  return {
    cancel: () => {
      if (timer !== undefined) window.clearTimeout(timer);
      markReady();
    },
    ready: readyPromise,
    restore: () => {
      if (target && applied) restore(target);
    },
  };
}

function useTermReviewData(enabled: boolean) {
  const [queue, setQueue] = useState<TermReviewQueueItem[]>([]);
  const [audit, setAudit] = useState<TermResolutionAuditItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(emptyResolutionDraft);
  const [pending, setPending] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [undoDecision, setUndoDecision] =
    useState<TermResolutionAuditItem | null>(null);
  const dismissedKeys = useRef(new Set<string>());
  const latestRegistryVersion = useRef<number | undefined>(undefined);
  const queuedMutationCount = useRef(0);
  const successfulQueuedMutations = useRef(0);
  const queuedSuccessMessage = useRef("");
  const mutationQueue = useRef(Promise.resolve());
  const refresh = useCallback(async () => {
    const [nextQueue, nextAudit] = await Promise.all([
      loadTermReviewQueue(),
      loadTermResolutionAudit(),
    ]);
    const versions = [
      ...nextQueue.map(({ registryVersion }) => registryVersion),
      ...nextAudit.map(({ registryVersion }) => registryVersion),
    ];
    if (versions.length > 0) {
      latestRegistryVersion.current = Math.max(...versions);
    }
    setQueue(
      nextQueue.filter(
        (item) => !dismissedKeys.current.has(queueItemKey(item)),
      ),
    );
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

  const recordQueuedSuccess = (
    result: unknown,
    successMessage: string | undefined,
  ) => {
    const registryVersion = resultRegistryVersion(result);
    if (registryVersion !== undefined) {
      latestRegistryVersion.current = registryVersion;
    }
    successfulQueuedMutations.current += 1;
    queuedSuccessMessage.current = successMessage ?? "Action completed.";
  };

  const restoreQueuedFailure = async (
    targetKey: string,
    optimistic: ReturnType<typeof scheduleOptimisticAdvance>,
    error: unknown,
  ) => {
    dismissedKeys.current.delete(targetKey);
    optimistic.cancel();
    optimistic.restore();
    setError(mutationErrorMessage(error, "Could not save the decision."));
    try {
      await refresh();
    } catch {
      // Keep the mutation error visible when reconciliation also fails.
    }
  };

  const refreshAfterQueuedMutations = async () => {
    if (queuedMutationCount.current !== 0) return;
    try {
      const { nextAudit } = await refresh();
      if (queuedMutationCount.current !== 0) return;
      if (successfulQueuedMutations.current > 0) {
        setUndoDecision(
          nextAudit.find(({ action }) => action !== "reversal") ?? null,
        );
        setStatus(queuedSuccessMessage.current);
      }
      successfulQueuedMutations.current = 0;
      queuedSuccessMessage.current = "";
    } catch (refreshError) {
      setError(
        mutationErrorMessage(refreshError, "Could not refresh term review."),
      );
    }
  };

  const finishQueuedMutation = async (
    operationSucceeded: boolean,
    targetKey: string,
    optimistic: ReturnType<typeof scheduleOptimisticAdvance>,
  ) => {
    if (operationSucceeded) dismissedKeys.current.delete(targetKey);
    await optimistic.ready;
    optimistic.cancel();
    queuedMutationCount.current -= 1;
    setSavingCount(queuedMutationCount.current);
    await refreshAfterQueuedMutations();
  };

  const runQueuedMutation = async (
    operation: Parameters<TermReviewMutation>[0],
    successMessage: string | undefined,
    targetKey: string,
    optimistic: ReturnType<typeof scheduleOptimisticAdvance>,
  ) => {
    let operationSucceeded = false;
    try {
      const result = await operation(latestRegistryVersion.current);
      operationSucceeded = true;
      recordQueuedSuccess(result, successMessage);
    } catch (mutationError) {
      await restoreQueuedFailure(targetKey, optimistic, mutationError);
    } finally {
      await finishQueuedMutation(operationSucceeded, targetKey, optimistic);
    }
  };

  const mutate: TermReviewMutation = async (operation, options) => {
    const optimisticTarget = options?.optimisticTarget;
    if (optimisticTarget) {
      const targetKey = queueItemKey(optimisticTarget);
      dismissedKeys.current.add(targetKey);
      queuedMutationCount.current += 1;
      setSavingCount(queuedMutationCount.current);
      setError(null);
      setStatus("");
      setUndoDecision(null);
      const optimistic = scheduleOptimisticAdvance(
        optimisticTarget,
        options?.optimisticDelayMs ?? 0,
        (target) => {
          setQueue((current) =>
            current.filter(
              (item) => queueItemKey(item) !== queueItemKey(target),
            ),
          );
          setSelected(0);
          setDraft(emptyResolutionDraft);
        },
        (target) => {
          setQueue((current) =>
            current.some((item) => queueItemKey(item) === queueItemKey(target))
              ? current
              : [target, ...current],
          );
          setSelected(0);
          setDraft(resolutionDraftFor(target));
        },
      );
      const run = () =>
        runQueuedMutation(
          operation,
          options?.successMessage,
          targetKey,
          optimistic,
        );
      mutationQueue.current = mutationQueue.current.then(run, run);
      return;
    }

    setPending(true);
    setError(null);
    setStatus("");
    setUndoDecision(null);
    try {
      const result = await operation(latestRegistryVersion.current);
      const registryVersion = resultRegistryVersion(result);
      if (registryVersion !== undefined) {
        latestRegistryVersion.current = registryVersion;
      }
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
    pending: pending || savingCount > 0,
    queue,
    savingCount,
    selected,
    setDraft,
    setSelected,
    status,
    swipeDisabled: pending,
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
          key={queueItemKey(term)}
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
  expectedRegistryVersion = item.registryVersion,
) {
  const requiresExplicitReview = action !== "defer";
  return {
    action,
    idempotencyKey: crypto.randomUUID(),
    rationale:
      draft.rationale.trim() || defaultRationale(action, draft.targetSlug),
    expectedRegistryVersion,
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

function EvidenceDisclosure({
  draft,
  item,
  setDraft,
}: Readonly<{
  draft: ResolutionDraft;
  item: TermReviewQueueItem;
  setDraft: (draft: ResolutionDraft) => void;
}>) {
  const matchCount = rankedCandidates(item).length;
  return (
    <details className="mt-4 rounded-lg border border-[var(--line)] px-3 py-2">
      <summary className="cursor-pointer rt-body text-sm font-medium">
        View evidence · {item.contexts.length} source
        {item.contexts.length === 1 ? "" : "s"} · {matchCount} possible match
        {matchCount === 1 ? "" : "es"}
      </summary>
      <div className="mt-4">
        <TermReviewEvidence
          item={item}
          selectedSlug={draft.targetSlug}
          selectCandidate={(targetSlug) =>
            setDraft({ ...draft, action: "alias", targetSlug })
          }
        />
      </div>
    </details>
  );
}

function useReviewSwipe(
  disabled: boolean,
  match: ((exitDurationMs: number) => Promise<void>) | null,
  reject: (exitDurationMs: number) => Promise<void>,
) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);

  const reset = () => {
    start.current = null;
    setDragging(false);
    setOffset(0);
  };
  const finish = async (
    direction: -1 | 1,
    action: (exitDurationMs: number) => Promise<void>,
  ) => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const exitDurationMs = reduceMotion ? 0 : 180;
    setDragging(false);
    setSettling(true);
    setOffset(reduceMotion ? 0 : direction * Math.max(window.innerWidth, 480));
    try {
      await Promise.all([
        action(exitDurationMs),
        new Promise((resolve) => window.setTimeout(resolve, exitDurationMs)),
      ]);
    } finally {
      setOffset(0);
      setSettling(false);
    }
  };
  const handlers = {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const target = event.target;
      if (
        disabled ||
        settling ||
        (target instanceof Element &&
          target.closest("button, input, textarea, select, a, summary"))
      ) {
        reset();
        return;
      }
      const touch = event.touches[0];
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
      const origin = start.current;
      if (disabled || settling || !touch || !origin) return;
      const xDistance = touch.clientX - origin.x;
      const yDistance = touch.clientY - origin.y;
      if (
        Math.abs(xDistance) <= Math.abs(yDistance) ||
        (xDistance > 0 && !match)
      ) {
        setDragging(false);
        setOffset(0);
        return;
      }
      setDragging(true);
      setOffset(Math.sign(xDistance) * Math.min(Math.abs(xDistance), 160));
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const touch = event.changedTouches[0];
      const origin = start.current;
      start.current = null;
      if (disabled || settling || !touch || !origin) {
        reset();
        return;
      }
      const xDistance = touch.clientX - origin.x;
      const yDistance = touch.clientY - origin.y;
      if (
        Math.abs(xDistance) < 72 ||
        Math.abs(xDistance) < Math.abs(yDistance) * 1.5
      ) {
        reset();
        return;
      }
      const action = xDistance > 0 ? match : reject;
      if (!action) {
        reset();
        return;
      }
      void finish(xDistance > 0 ? 1 : -1, action);
    },
    onTouchCancel: reset,
  };
  return { dragging, handlers, offset };
}

function ReviewSwipeHint({
  action,
  targetSlug,
}: Readonly<{
  action: "alias" | "new_canonical" | null;
  targetSlug: string;
}>) {
  return (
    <p className="mt-2 rt-body text-xs text-[var(--ink-3)] sm:hidden">
      {action && (
        <>
          Swipe right to {action === "alias" ? "match" : "create"}{" "}
          {targetSlug.replaceAll("-", " ")} ·{" "}
        </>
      )}
      Swipe left for not a term
    </p>
  );
}

function SwipeActionBackdrop({
  action,
  offset,
  targetSlug,
}: Readonly<{
  action: "alias" | "new_canonical" | null;
  offset: number;
  targetSlug: string;
}>) {
  const opacity = Math.min(Math.abs(offset) / 72, 1);
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-between bg-[var(--paper-warm)] px-5 rt-body font-semibold"
    >
      {action && (
        <span
          className="text-[var(--sage)]"
          style={{ opacity: offset > 0 ? opacity : 0 }}
        >
          {action === "new_canonical" ? "Create" : "Match"}{" "}
          {targetSlug.replaceAll("-", " ")}
        </span>
      )}
      <span
        className="text-[var(--berry)]"
        style={{ opacity: offset < 0 ? opacity : 0 }}
      >
        Not a term
      </span>
    </div>
  );
}

type ReviewCardProps = Readonly<{
  deferred: boolean;
  draft: ResolutionDraft;
  item: TermReviewQueueItem;
  mutate: TermReviewMutation;
  pending: boolean;
  setDraft: (draft: ResolutionDraft) => void;
  swipeDisabled: boolean;
}>;

function swipeMatchAction(action: ResolutionDraft["action"]) {
  return action === "alias" || action === "new_canonical" ? action : null;
}

function submitReviewDecision(
  item: TermReviewQueueItem,
  draft: ResolutionDraft,
  action: ResolutionDraft["action"],
  mutate: TermReviewMutation,
  optimisticDelayMs?: number,
) {
  return mutate(
    (expectedRegistryVersion) =>
      submitTermResolution({
        target: item,
        command: reviewCommand(item, draft, action, expectedRegistryVersion),
      }),
    {
      offerUndo: true,
      successMessage: resolutionSuccessMessage(action),
      ...(optimisticDelayMs === undefined
        ? {}
        : { optimisticDelayMs, optimisticTarget: item }),
    },
  );
}

function ReviewCard({
  deferred,
  draft,
  item,
  mutate,
  pending,
  setDraft,
  swipeDisabled,
}: ReviewCardProps) {
  const submitAction = (action = draft.action, optimisticDelayMs?: number) =>
    submitReviewDecision(item, draft, action, mutate, optimisticDelayMs);
  const matchAction = swipeMatchAction(draft.action);
  const swipe = useReviewSwipe(
    swipeDisabled,
    matchAction && draft.targetSlug
      ? (exitDurationMs) => submitAction(matchAction, exitDurationMs)
      : null,
    (exitDurationMs) => submitAction("reject", exitDurationMs),
  );
  return (
    <div className="relative overflow-hidden rounded-xl">
      <SwipeActionBackdrop
        action={matchAction}
        offset={swipe.offset}
        targetSlug={draft.targetSlug}
      />
      <article
        aria-label={`Review ${item.rawTexts[0]}`}
        className="relative touch-pan-y rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 transition-transform duration-200 ease-out motion-reduce:transition-none sm:p-6"
        style={{
          transform: `translateX(${swipe.offset}px) rotate(${swipe.offset / 40}deg)`,
          transitionDuration: swipe.dragging ? "0ms" : undefined,
        }}
        {...swipe.handlers}
      >
        <ReviewCardHeader item={item} />
        <ReviewSwipeHint action={matchAction} targetSlug={draft.targetSlug} />
        <EvidenceDisclosure draft={draft} item={item} setDraft={setDraft} />
        <TermResolutionForm
          deferred={deferred}
          draft={draft}
          item={item}
          pending={pending}
          setDraft={setDraft}
          submit={submitAction}
        />
      </article>
    </div>
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
    return data.swipeDisabled ? null : (
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
        key={queueItemKey(item)}
        deferred={deferred}
        draft={data.draft}
        item={item}
        mutate={data.mutate}
        pending={data.pending}
        setDraft={data.setDraft}
        swipeDisabled={data.swipeDisabled}
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
      {data.savingCount > 0 ? (
        <span>
          Saving {data.savingCount} decision
          {data.savingCount === 1 ? "" : "s"}…
        </span>
      ) : (
        data.pending && <span>Working…</span>
      )}
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
