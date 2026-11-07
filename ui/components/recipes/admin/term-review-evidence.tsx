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

function contextOrigin(
  context: TermReviewQueueItem["contexts"][number],
): string {
  return context.provenance.kind === "import"
    ? `Import job ${context.provenance.importJobId ?? "unknown"}`
    : "Direct user submission";
}

function shortObservedDate(
  context: TermReviewQueueItem["contexts"][number],
): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(context.lastSeenAt));
}

function fieldLabel(context: TermReviewQueueItem["contexts"][number]): string {
  const field = context.sourceContext.field;
  if (!field) return "Unspecified field";
  return `${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function ContextDetails({
  context,
}: Readonly<{ context: TermReviewQueueItem["contexts"][number] }>) {
  return (
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rt-mono text-xs text-[var(--ink-3)]">
      <dt>Source ID</dt>
      <dd className="min-w-0 break-all">
        {context.sourceContext.resourceId ?? "Not recorded"}
      </dd>
      <dt>Field</dt>
      <dd>{context.sourceContext.field ?? "Not recorded"}</dd>
      <dt>Origin</dt>
      <dd className="min-w-0 break-all">{contextOrigin(context)}</dd>
      <dt>Actor</dt>
      <dd className="min-w-0 break-all">{context.provenance.actorUserId}</dd>
      <dt>Observed</dt>
      <dd>{observedRange(context)}</dd>
      <dt>Locale</dt>
      <dd>{context.locale}</dd>
    </dl>
  );
}

function ContextSummary({
  context,
}: Readonly<{ context: TermReviewQueueItem["contexts"][number] }>) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-[var(--line)] py-3 first:border-t-0">
      <div className="min-w-0">
        <h4 className="rt-body font-medium">{contextTitle(context)}</h4>
        <p className="mt-0.5 rt-body text-sm text-[var(--ink-3)]">
          {fieldLabel(context)} ·{" "}
          {context.provenance.kind === "import" ? "Imported" : "Direct"} ·{" "}
          {shortObservedDate(context)}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-[var(--paper-warm)] px-2.5 py-1 rt-mono text-xs text-[var(--ink-3)]">
        {context.submissionCount}×
      </span>
    </li>
  );
}

function TechnicalProvenance({
  contexts,
}: Readonly<{ contexts: TermReviewQueueItem["contexts"] }>) {
  return (
    <details className="border-t border-[var(--line)] pt-3">
      <summary className="cursor-pointer rt-body text-sm text-[var(--ink-3)]">
        Technical provenance
      </summary>
      <ul className="mt-2 space-y-4">
        {contexts.map((context) => (
          <li
            key={`${context.termId}:${context.observationKey}`}
            className="border-l-2 border-[var(--line)] pl-3"
          >
            <p className="rt-body text-sm font-medium">
              {contextTitle(context)} · {context.rawText}
            </p>
            <ContextDetails context={context} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function SubmissionContexts({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  return (
    <section aria-labelledby="submission-contexts-heading">
      <h3 id="submission-contexts-heading" className="rt-display text-xl">
        Where it appeared
      </h3>
      <p className="mt-1 rt-body text-sm text-[var(--ink-3)]">
        {item.submissionCount} submissions across {item.contexts.length} source
        {item.contexts.length === 1 ? "" : "s"}.
      </p>
      <ul className="mt-2">
        {item.contexts.map((context) => (
          <ContextSummary
            key={`${context.termId}:${context.observationKey}`}
            context={context}
          />
        ))}
      </ul>
      <TechnicalProvenance contexts={item.contexts} />
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
    <ol className="mt-2 space-y-2">
      {candidates.map(({ slug }, index) => (
        <li
          key={slug}
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3"
        >
          <span>
            <span className="block rt-body font-medium">
              {slug
                .split("-")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ")}
            </span>
            <span className="block rt-mono text-xs text-[var(--ink-3)]">
              {slug} · {index === 0 ? "Suggested" : "Alternative"}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={
              selectedSlug === slug ? `${slug} selected` : `Match ${slug}`
            }
            aria-pressed={selectedSlug === slug}
            onClick={() => selectCandidate(slug)}
          >
            {selectedSlug === slug ? "Selected" : "Match"}
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
        Possible matches
      </h3>
      {candidates.length === 0 ? (
        <p className="mt-2 rt-body text-[var(--ink-3)]">
          No candidate matches.
        </p>
      ) : (
        <CandidateList
          candidates={candidates}
          selectedSlug={selectedSlug}
          selectCandidate={selectCandidate}
        />
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
