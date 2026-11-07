import { Button } from "@/components/ui/button";
import type { TermReviewQueueItem } from "@/lib/api/term-resolution";
import { rankedCandidates } from "./term-review-types";

function contextTitle(
  context: TermReviewQueueItem["contexts"][number],
): string {
  if (context.sourceContext.flow === "recipe") {
    return context.provenance.kind === "import"
      ? "Imported recipe"
      : "Authored recipe";
  }
  if (context.sourceContext.flow === "pantry") return "Pantry entry";
  if (context.sourceContext.flow === "diet") return "Diet exclusion";
  return "Equipment inventory";
}

function observedRange(
  context: TermReviewQueueItem["contexts"][number],
): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const first = formatter.format(new Date(context.firstSeenAt));
  const last = formatter.format(new Date(context.lastSeenAt));
  return first === last ? `${first} UTC` : `${first} – ${last} UTC`;
}

function ContextDetails({
  context,
}: Readonly<{ context: TermReviewQueueItem["contexts"][number] }>) {
  const origin =
    context.provenance.kind === "import"
      ? `Import job ${context.provenance.importJobId ?? "unknown"}`
      : "Direct user submission";
  return (
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rt-mono text-xs text-[var(--ink-3)]">
      <dt>Source</dt>
      <dd className="min-w-0 break-all text-[var(--ink)]">
        {context.sourceContext.resourceId ?? "Unknown resource"}
      </dd>
      <dt>Field</dt>
      <dd>{context.sourceContext.field ?? "Not recorded"}</dd>
      <dt>Origin</dt>
      <dd className="min-w-0 break-all">{origin}</dd>
      <dt>Actor</dt>
      <dd className="min-w-0 break-all">{context.provenance.actorUserId}</dd>
      <dt>Observed</dt>
      <dd>{observedRange(context)}</dd>
      <dt>Locale</dt>
      <dd>{context.locale}</dd>
      <dt>Frequency</dt>
      <dd>
        {context.submissionCount} submission
        {context.submissionCount === 1 ? "" : "s"}
      </dd>
    </dl>
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
            <h4 className="rt-body font-medium">{contextTitle(context)}</h4>
            <p className="mt-1 rt-body">{context.rawText}</p>
            <ContextDetails context={context} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CandidateList({
  candidates,
  selectedSlug,
  selectCandidate,
}: Readonly<{
  candidates: ReturnType<typeof rankedCandidates>;
  selectedSlug: string;
  selectCandidate: (slug: string) => void;
}>) {
  return (
    <ol aria-describedby="candidate-ranking-help" className="mt-3 space-y-2">
      {candidates.map(({ slug }, index) => (
        <li
          key={slug}
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3"
        >
          <span>
            <span className="block rt-body font-medium">{slug}</span>
            <span className="block rt-mono text-xs text-[var(--ink-3)]">
              {index === 0
                ? "Top-ranked candidate"
                : `Alternative ${index + 1}`}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={selectedSlug === slug}
            onClick={() => selectCandidate(slug)}
          >
            {selectedSlug === slug ? "Selected" : "Use slug"}
          </Button>
        </li>
      ))}
    </ol>
  );
}

function CandidateEvidence({
  item,
  selectedSlug,
  selectCandidate,
}: Readonly<{
  item: TermReviewQueueItem;
  selectedSlug: string;
  selectCandidate: (slug: string) => void;
}>) {
  const candidates = rankedCandidates(item);
  return (
    <section aria-labelledby="candidate-evidence-heading">
      <h3 id="candidate-evidence-heading" className="rt-display text-xl">
        Candidate matches
      </h3>
      {candidates.length === 0 ? (
        <p className="mt-2 rt-body text-[var(--ink-3)]">
          No candidate matches.
        </p>
      ) : (
        <>
          <p
            id="candidate-ranking-help"
            className="mt-2 rt-body text-sm text-[var(--ink-3)]"
          >
            Ranked by the parser for comparison. The ranking is evidence, not a
            probability or an approval threshold.
          </p>
          <CandidateList
            candidates={candidates}
            selectedSlug={selectedSlug}
            selectCandidate={selectCandidate}
          />
        </>
      )}
    </section>
  );
}

export function TermReviewEvidence({
  item,
  selectedSlug,
  selectCandidate,
}: Readonly<{
  item: TermReviewQueueItem;
  selectedSlug: string;
  selectCandidate: (slug: string) => void;
}>) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SubmissionContexts item={item} />
      <CandidateEvidence
        item={item}
        selectedSlug={selectedSlug}
        selectCandidate={selectCandidate}
      />
    </div>
  );
}
