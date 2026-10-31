"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadTermResolutionAudit,
  loadTermReviewQueue,
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
  const refresh = useCallback(async () => {
    const [nextQueue, nextAudit] = await Promise.all([
      loadTermReviewQueue(),
      loadTermResolutionAudit(),
    ]);
    setQueue(nextQueue);
    setAudit(nextAudit);
    setSelected((index) => Math.min(index, Math.max(nextQueue.length - 1, 0)));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    setPending(true);
    refresh()
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load term review.",
        ),
      )
      .finally(() => setPending(false));
  }, [enabled, refresh]);
  const mutate: TermReviewMutation = async (operation) => {
    setPending(true);
    setError(null);
    setStatus("");
    try {
      await operation();
      await refresh();
      setDraft(emptyResolutionDraft);
      setStatus("Decision saved and projections refreshed.");
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
        Repeated submissions rank first. Raw text remains unchanged while each
        decision writes a versioned registry revision and a retryable
        projection.
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

function reviewCommand(item: TermReviewQueueItem, draft: ResolutionDraft) {
  return {
    action: draft.action,
    idempotencyKey: crypto.randomUUID(),
    rationale: draft.rationale,
    expectedRegistryVersion: item.registryVersion,
    evidence: item.contexts.flatMap((context) =>
      context.candidateMatches.map(
        (candidate) => `${candidate.slug}:${candidate.score.toFixed(4)}`,
      ),
    ),
    localeReview: draft.localeReview,
    collisionReview: draft.collisionReview,
    ...(["alias", "new_canonical", "merge"].includes(draft.action)
      ? { targetSlug: draft.targetSlug }
      : {}),
    ...(draft.action === "new_canonical"
      ? { canonicalName: draft.canonicalName }
      : {}),
  };
}

function ReviewCard({
  draft,
  item,
  mutate,
  pending,
  setDraft,
}: Readonly<{
  draft: ResolutionDraft;
  item: TermReviewQueueItem;
  mutate: TermReviewMutation;
  pending: boolean;
  setDraft: (draft: ResolutionDraft) => void;
}>) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 sm:p-6">
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
      <div className="mt-6">
        <TermReviewEvidence item={item} />
      </div>
      <TermResolutionForm
        draft={draft}
        item={item}
        pending={pending}
        setDraft={setDraft}
        submit={() =>
          mutate(() =>
            submitTermResolution({
              target: item,
              command: reviewCommand(item, draft),
            }),
          )
        }
      />
    </article>
  );
}

function ReviewWorkspace({
  data,
}: Readonly<{ data: ReturnType<typeof useTermReviewData> }>) {
  const item = data.queue[data.selected];
  if (!item) {
    return data.pending ? null : (
      <p className="mt-8 rounded-xl border border-[var(--line)] p-6 rt-body">
        No unresolved terms are waiting for review.
      </p>
    );
  }
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
      <ReviewQueue
        queue={data.queue}
        selected={data.selected}
        select={(index) => {
          data.setSelected(index);
          data.setDraft(emptyResolutionDraft);
        }}
      />
      <ReviewCard
        draft={data.draft}
        item={item}
        mutate={data.mutate}
        pending={data.pending}
        setDraft={data.setDraft}
      />
    </div>
  );
}

function AdminDashboard() {
  const data = useTermReviewData(true);
  return (
    <main className="container mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <DashboardHeader />
      <div aria-live="polite" className="mt-4 min-h-6 rt-body">
        {data.pending && <span>Working…</span>}
        {data.status && <span>{data.status}</span>}
      </div>
      {data.error && (
        <p role="alert" className="mt-2 rt-body text-[var(--berry)]">
          {data.error}
        </p>
      )}
      <ReviewWorkspace data={data} />
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
