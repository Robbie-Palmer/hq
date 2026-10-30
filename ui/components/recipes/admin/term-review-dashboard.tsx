"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadTermResolutionAudit,
  loadTermReviewQueue,
  retryTermReprojection,
  reverseTermResolution,
  submitTermResolution,
  type TermResolutionAction,
  type TermResolutionAuditItem,
  type TermReviewQueueItem,
} from "@/lib/api/term-resolution";
import { authClient } from "@/lib/auth-client";

type ResolutionDraft = {
  action: Exclude<TermResolutionAction, "reversal">;
  targetSlug: string;
  canonicalName: string;
  rationale: string;
  localeReview: boolean;
  collisionReview: boolean;
};

const emptyDraft: ResolutionDraft = {
  action: "alias",
  targetSlug: "",
  canonicalName: "",
  rationale: "",
  localeReview: false,
  collisionReview: false,
};

function candidateEvidence(item: TermReviewQueueItem) {
  const candidates = new Map<string, number>();
  for (const context of item.contexts) {
    for (const candidate of context.candidateMatches) {
      candidates.set(
        candidate.slug,
        Math.max(candidate.score, candidates.get(candidate.slug) ?? 0),
      );
    }
  }
  return [...candidates.entries()].sort(
    ([leftSlug, leftScore], [rightSlug, rightScore]) =>
      rightScore - leftScore || leftSlug.localeCompare(rightSlug),
  );
}

function ReviewEvidence({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  const candidates = candidateEvidence(item);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="submission-contexts-heading">
        <h3 id="submission-contexts-heading" className="rt-display text-xl">
          Submission contexts
        </h3>
        <ul className="mt-2 space-y-2">
          {item.contexts.map((context) => (
            <li
              key={`${context.termId}:${context.observationKey}`}
              className="rounded-lg border border-[var(--line)] bg-[var(--paper-warm)] p-3"
            >
              <p className="rt-body">{context.rawText}</p>
              <p className="rt-mono text-xs text-[var(--ink-3)]">
                {context.sourceContext.flow}
                {context.sourceContext.field
                  ? ` · ${context.sourceContext.field}`
                  : ""}
                {` · ${context.locale} · ${context.submissionCount} submission${context.submissionCount === 1 ? "" : "s"}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="candidate-evidence-heading">
        <h3 id="candidate-evidence-heading" className="rt-display text-xl">
          Candidate evidence
        </h3>
        {candidates.length === 0 ? (
          <p className="mt-2 rt-body text-[var(--ink-3)]">
            No candidate matches.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {candidates.map(([slug, score]) => (
              <li
                key={slug}
                className="flex justify-between gap-3 rt-mono text-sm"
              >
                <span>{slug}</span>
                <span>{Math.round(score * 100)}%</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ResolutionForm({
  draft,
  item,
  pending,
  setDraft,
  submit,
}: Readonly<{
  draft: ResolutionDraft;
  item: TermReviewQueueItem;
  pending: boolean;
  setDraft: (draft: ResolutionDraft) => void;
  submit: () => Promise<void>;
}>) {
  const needsTarget = ["alias", "new_canonical", "merge"].includes(
    draft.action,
  );
  return (
    <form
      className="mt-6 space-y-4 border-t border-[var(--line)] pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            className="rt-body text-sm font-medium"
            htmlFor="term-resolution-action"
          >
            Decision
          </label>
          <select
            id="term-resolution-action"
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 rt-body"
            value={draft.action}
            onChange={(event) =>
              setDraft({
                ...draft,
                action: event.target.value as ResolutionDraft["action"],
              })
            }
          >
            <option value="alias">Add alias</option>
            <option value="new_canonical">Create canonical item</option>
            <option value="merge">Merge into canonical item</option>
            <option value="defer">Defer</option>
            <option value="reject">Reject</option>
          </select>
        </div>
        {needsTarget && (
          <div>
            <label
              className="rt-body text-sm font-medium"
              htmlFor="term-target-slug"
            >
              Canonical slug
            </label>
            <Input
              id="term-target-slug"
              className="mt-1"
              required
              value={draft.targetSlug}
              onChange={(event) =>
                setDraft({ ...draft, targetSlug: event.target.value })
              }
            />
          </div>
        )}
      </div>
      {draft.action === "new_canonical" && (
        <div>
          <label
            className="rt-body text-sm font-medium"
            htmlFor="term-canonical-name"
          >
            Canonical display name
          </label>
          <Input
            id="term-canonical-name"
            className="mt-1"
            required
            value={draft.canonicalName}
            onChange={(event) =>
              setDraft({ ...draft, canonicalName: event.target.value })
            }
          />
        </div>
      )}
      <div>
        <label className="rt-body text-sm font-medium" htmlFor="term-rationale">
          Rationale
        </label>
        <textarea
          id="term-rationale"
          className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 rt-body"
          required
          value={draft.rationale}
          onChange={(event) =>
            setDraft({ ...draft, rationale: event.target.value })
          }
        />
      </div>
      {(item.localeReviewRequired || item.collisionReviewRequired) && (
        <fieldset className="space-y-2 rounded-lg border border-[var(--line-strong)] p-3">
          <legend className="px-1 rt-display text-lg">Required review</legend>
          {item.localeReviewRequired && (
            <label className="flex items-start gap-2 rt-body">
              <input
                type="checkbox"
                required
                checked={draft.localeReview}
                onChange={(event) =>
                  setDraft({ ...draft, localeReview: event.target.checked })
                }
              />
              <span>I reviewed the ambiguous or unknown locale.</span>
            </label>
          )}
          {item.collisionReviewRequired && (
            <label className="flex items-start gap-2 rt-body">
              <input
                type="checkbox"
                required
                checked={draft.collisionReview}
                onChange={(event) =>
                  setDraft({ ...draft, collisionReview: event.target.checked })
                }
              />
              <span>I reviewed the conflicting candidate matches.</span>
            </label>
          )}
        </fieldset>
      )}
      <Button type="submit" disabled={pending}>
        {pending && (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        )}
        Record decision
      </Button>
    </form>
  );
}

function AuditLog({
  items,
  mutate,
  pending,
}: Readonly<{
  items: TermResolutionAuditItem[];
  mutate: (operation: () => Promise<void>) => Promise<void>;
  pending: boolean;
}>) {
  return (
    <section aria-labelledby="term-audit-heading" className="mt-10">
      <h2 id="term-audit-heading" className="rt-display text-3xl">
        Audit log
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full min-w-[48rem] text-left">
          <thead className="bg-[var(--paper-warm)] rt-mono text-xs">
            <tr>
              <th scope="col" className="p-3">
                Term
              </th>
              <th scope="col" className="p-3">
                Decision
              </th>
              <th scope="col" className="p-3">
                Registry
              </th>
              <th scope="col" className="p-3">
                Projection
              </th>
              <th scope="col" className="p-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-t border-[var(--line)] align-top"
              >
                <th scope="row" className="p-3 rt-body font-medium">
                  {item.normalizedText}
                  <span className="block rt-mono text-xs text-[var(--ink-3)]">
                    {item.kind} · {item.locale}
                  </span>
                </th>
                <td className="p-3 rt-body">
                  {item.action.replace("_", " ")}
                  {item.targetSlug ? ` → ${item.targetSlug}` : ""}
                  <span className="block text-xs text-[var(--ink-3)]">
                    {item.rationale}
                  </span>
                </td>
                <td className="p-3 rt-mono text-sm">v{item.registryVersion}</td>
                <td className="p-3 rt-mono text-sm">
                  {item.reprojection?.status ?? "missing"}
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    {item.reprojection?.status === "failed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void mutate(() => retryTermReprojection(item.id))
                        }
                      >
                        Retry
                      </Button>
                    )}
                    {item.action !== "reversal" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void mutate(() =>
                            reverseTermResolution(
                              item,
                              "Reviewer reversed the prior decision.",
                            ),
                          )
                        }
                      >
                        <RotateCcw aria-hidden="true" /> Reverse
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TermReviewDashboard() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [queue, setQueue] = useState<TermReviewQueueItem[]>([]);
  const [audit, setAudit] = useState<TermResolutionAuditItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const isAdmin = session?.user.role === "admin";

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
    if (!isAdmin) return;
    setPending(true);
    refresh()
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load term review.",
        );
      })
      .finally(() => setPending(false));
  }, [isAdmin, refresh]);

  async function mutate(operation: () => Promise<void>) {
    setPending(true);
    setError(null);
    setStatus("");
    try {
      await operation();
      await refresh();
      setDraft(emptyDraft);
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
  }

  if (sessionPending) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <output aria-live="polite">Loading reviewer access…</output>
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="rt-display text-4xl">Term review</h1>
        <p role="alert" className="mt-4 rt-body text-[var(--berry)]">
          Administrator access is required to review terms across accounts.
        </p>
      </main>
    );
  }

  const item = queue[selected];
  return (
    <main className="container mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
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
      <div aria-live="polite" className="mt-4 min-h-6 rt-body">
        {pending && <span>Working…</span>}
        {status && <span>{status}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 rt-body text-[var(--berry)]">
          {error}
        </p>
      )}

      {item ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Unresolved terms" className="space-y-2">
            {queue.map((term, index) => (
              <button
                key={`${term.kind}:${term.normalizedText}:${term.locale}`}
                type="button"
                aria-current={index === selected ? "true" : undefined}
                className="w-full rounded-lg border border-[var(--line)] p-3 text-left aria-[current=true]:border-[var(--terracotta)] aria-[current=true]:bg-[var(--paper-warm)]"
                onClick={() => {
                  setSelected(index);
                  setDraft(emptyDraft);
                }}
              >
                <span className="block rt-body font-medium">
                  {term.rawTexts[0]}
                </span>
                <span className="block rt-mono text-xs text-[var(--ink-3)]">
                  {term.submissionCount} submissions · {term.tenantCount}{" "}
                  accounts
                </span>
              </button>
            ))}
          </nav>
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
              <ReviewEvidence item={item} />
            </div>
            <ResolutionForm
              draft={draft}
              item={item}
              pending={pending}
              setDraft={setDraft}
              submit={() =>
                mutate(() =>
                  submitTermResolution({
                    target: item,
                    command: {
                      action: draft.action,
                      idempotencyKey: crypto.randomUUID(),
                      rationale: draft.rationale,
                      expectedRegistryVersion: item.registryVersion,
                      evidence: item.contexts.flatMap((context) =>
                        context.candidateMatches.map(
                          (candidate) =>
                            `${candidate.slug}:${candidate.score.toFixed(4)}`,
                        ),
                      ),
                      localeReview: draft.localeReview,
                      collisionReview: draft.collisionReview,
                      ...(["alias", "new_canonical", "merge"].includes(
                        draft.action,
                      )
                        ? { targetSlug: draft.targetSlug }
                        : {}),
                      ...(draft.action === "new_canonical"
                        ? { canonicalName: draft.canonicalName }
                        : {}),
                    },
                  }),
                )
              }
            />
          </article>
        </div>
      ) : (
        !pending && (
          <p className="mt-8 rounded-xl border border-[var(--line)] p-6 rt-body">
            No unresolved terms are waiting for review.
          </p>
        )
      )}
      <AuditLog items={audit} mutate={mutate} pending={pending} />
    </main>
  );
}
