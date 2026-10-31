import type { TermReviewQueueItem } from "@/lib/api/term-resolution";

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

function SubmissionContexts({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  return (
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
  );
}

function CandidateEvidence({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  const candidates = candidateEvidence(item);
  return (
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
  );
}

export function TermReviewEvidence({
  item,
}: Readonly<{ item: TermReviewQueueItem }>) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SubmissionContexts item={item} />
      <CandidateEvidence item={item} />
    </div>
  );
}
