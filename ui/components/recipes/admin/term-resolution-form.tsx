import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TermReviewQueueItem } from "@/lib/api/term-resolution";
import { type ResolutionDraft, rankedCandidates } from "./term-review-types";

type DraftProps = Readonly<{
  draft: ResolutionDraft;
  setDraft: (draft: ResolutionDraft) => void;
}>;

type CandidateDraftProps = DraftProps &
  Readonly<{
    candidateSlugs: string[];
    item: TermReviewQueueItem;
  }>;

const decisionGuidance: Record<
  ResolutionDraft["action"],
  { title: string; description: string }
> = {
  alias: {
    title: "Treat the wording as a synonym",
    description:
      "Map this authored wording to an existing canonical item. The original wording and evidence stay unchanged; no canonical items are combined.",
  },
  new_canonical: {
    title: "Create a distinct canonical item",
    description:
      "Use this when no existing item represents the term. The new item is added to the canonical registry and these observations map to it.",
  },
  merge: {
    title: "Record a consolidation decision",
    description:
      "Use this when competing names or candidates represent one item and the selected slug should survive. For an unresolved term the mapping matches an alias, while the audit records that this was a consolidation decision.",
  },
  defer: {
    title: "Return to this later",
    description:
      "No registry mapping is created. The term stays in the review queue with every context and candidate, the defer decision remains in the audit log, and structured features stay limited until a later resolution.",
  },
  reject: {
    title: "Exclude this term from active review",
    description:
      "No registry mapping is created. The term leaves the active queue, but its evidence and decision remain in the audit log and a reviewer can reverse the rejection later.",
  },
};

function DecisionSelect({
  draft,
  item,
  setDraft,
  candidateSlugs,
}: CandidateDraftProps) {
  return (
    <div>
      <label
        className="rt-body text-sm font-medium"
        htmlFor="term-resolution-action"
      >
        Decision
      </label>
      <select
        id="term-resolution-action"
        aria-describedby="term-resolution-impact"
        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 rt-body"
        value={draft.action}
        onChange={(event) => {
          const action = event.target.value as ResolutionDraft["action"];
          const targetIsCandidate = candidateSlugs.includes(draft.targetSlug);
          setDraft({
            ...draft,
            action,
            targetSlug:
              action === "new_canonical" && targetIsCandidate
                ? ""
                : draft.targetSlug || candidateSlugs[0] || "",
            canonicalName:
              action === "new_canonical"
                ? draft.canonicalName || item.rawTexts[0] || ""
                : draft.canonicalName,
          });
        }}
      >
        <option value="alias">Add alias</option>
        <option value="new_canonical">Create canonical item</option>
        <option value="merge">Merge into canonical item</option>
        <option value="defer">Defer</option>
        <option value="reject">Reject</option>
      </select>
    </div>
  );
}

function TargetSlugField({
  draft,
  setDraft,
  candidateSlugs,
}: CandidateDraftProps) {
  if (!["alias", "new_canonical", "merge"].includes(draft.action)) return null;
  return (
    <div>
      <label className="rt-body text-sm font-medium" htmlFor="term-target-slug">
        Canonical slug
      </label>
      <Input
        id="term-target-slug"
        className="mt-1"
        aria-describedby="term-target-slug-help"
        required
        value={draft.targetSlug}
        onChange={(event) =>
          setDraft({ ...draft, targetSlug: event.target.value })
        }
      />
      <p
        id="term-target-slug-help"
        className="mt-1 rt-body text-xs text-[var(--ink-3)]"
      >
        {candidateSlugs.length > 0 && draft.action !== "new_canonical"
          ? "Prefilled from the top-ranked candidate. Choose another candidate above or type a slug."
          : "Enter the stable slug for the canonical item."}
      </p>
    </div>
  );
}

function DecisionFields({
  draft,
  item,
  setDraft,
}: DraftProps & Readonly<{ item: TermReviewQueueItem }>) {
  const props = {
    draft,
    item,
    setDraft,
    candidateSlugs: rankedCandidates(item).map(({ slug }) => slug),
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DecisionSelect {...props} />
      <TargetSlugField {...props} />
    </div>
  );
}

function DecisionImpact({
  action,
}: Readonly<{ action: ResolutionDraft["action"] }>) {
  const guidance = decisionGuidance[action];
  return (
    <section
      id="term-resolution-impact"
      aria-live="polite"
      className="rounded-lg border border-[var(--line)] bg-[var(--paper-warm)] p-3"
    >
      <h3 className="rt-body font-medium">{guidance.title}</h3>
      <p className="mt-1 rt-body text-sm text-[var(--ink-3)]">
        {guidance.description}
      </p>
    </section>
  );
}

function CanonicalNameField({ draft, setDraft }: DraftProps) {
  if (draft.action !== "new_canonical") return null;
  return (
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
  );
}

function RationaleField({ draft, setDraft }: DraftProps) {
  return (
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
  );
}

function RequiredReview({
  draft,
  item,
  setDraft,
}: DraftProps & Readonly<{ item: TermReviewQueueItem }>) {
  if (
    draft.action === "defer" ||
    (!item.localeReviewRequired && !item.collisionReviewRequired)
  ) {
    return null;
  }
  return (
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
  );
}

export function TermResolutionForm({
  draft,
  item,
  pending,
  setDraft,
  submit,
}: DraftProps &
  Readonly<{
    item: TermReviewQueueItem;
    pending: boolean;
    submit: () => Promise<void>;
  }>) {
  return (
    <form
      className="mt-6 space-y-4 border-t border-[var(--line)] pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DecisionFields draft={draft} item={item} setDraft={setDraft} />
      <DecisionImpact action={draft.action} />
      <CanonicalNameField draft={draft} setDraft={setDraft} />
      <RationaleField draft={draft} setDraft={setDraft} />
      <RequiredReview draft={draft} item={item} setDraft={setDraft} />
      <Button type="submit" disabled={pending}>
        {pending && (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        )}
        Record decision
      </Button>
    </form>
  );
}
