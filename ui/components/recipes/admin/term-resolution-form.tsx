import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TermReviewQueueItem } from "@/lib/api/term-resolution";
import { type ResolutionDraft, rankedCandidates } from "./term-review-types";

type DraftProps = Readonly<{
  draft: ResolutionDraft;
  setDraft: (draft: ResolutionDraft) => void;
}>;

function newCanonicalSlug(rawText: string): string {
  return rawText
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function chooseAction(
  action: ResolutionDraft["action"],
  draft: ResolutionDraft,
  item: TermReviewQueueItem,
): ResolutionDraft {
  if (action === "new_canonical") {
    const name = item.rawTexts[0] ?? item.normalizedText;
    return {
      ...draft,
      action,
      canonicalName: draft.canonicalName || name,
      targetSlug: newCanonicalSlug(name),
    };
  }
  if (action === "alias") {
    return {
      ...draft,
      action,
      targetSlug: rankedCandidates(item)[0]?.slug ?? draft.targetSlug,
    };
  }
  return { ...draft, action };
}

const actionChoices: Array<{
  action: ResolutionDraft["action"];
  label: string;
  description: string;
}> = [
  {
    action: "alias",
    label: "Match existing",
    description: "Use an existing canonical item.",
  },
  {
    action: "new_canonical",
    label: "Create new",
    description: "Add a genuinely distinct item.",
  },
  {
    action: "reject",
    label: "Not a term",
    description: "Remove noise from the review queue.",
  },
];

function ActionChoices({
  draft,
  item,
  setDraft,
}: DraftProps & Readonly<{ item: TermReviewQueueItem }>) {
  return (
    <fieldset>
      <legend className="rt-body text-sm font-medium">What is it?</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {actionChoices.map(({ action, label, description }) => (
          <Button
            key={action}
            type="button"
            variant={draft.action === action ? "default" : "outline"}
            aria-label={label}
            aria-pressed={draft.action === action}
            className="h-auto min-h-16 justify-start px-3 py-2 text-left"
            onClick={() => setDraft(chooseAction(action, draft, item))}
          >
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-xs font-normal opacity-80">
                {description}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function TargetFields({ draft, setDraft }: DraftProps) {
  if (draft.action === "reject" || draft.action === "defer") return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
        <p className="mt-1 rt-body text-xs text-[var(--ink-3)]">
          {draft.action === "alias"
            ? "Filled from the selected candidate."
            : "Generated from the submitted term; edit if needed."}
        </p>
      </div>
      {draft.action === "new_canonical" && (
        <div>
          <label
            className="rt-body text-sm font-medium"
            htmlFor="term-canonical-name"
          >
            Display name
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
    </div>
  );
}

function ReviewWarnings({ item }: Readonly<{ item: TermReviewQueueItem }>) {
  const warnings = [
    item.localeReviewRequired ? "The locale is unknown or ambiguous." : null,
    item.collisionReviewRequired
      ? "The evidence points to more than one canonical item."
      : null,
  ].filter((warning): warning is string => warning !== null);
  if (warnings.length === 0) return null;
  return (
    <aside className="rounded-lg border border-[var(--line-strong)] bg-[var(--paper-warm)] p-3">
      <p className="rt-body text-sm font-medium">
        Saving records that you reviewed these warnings:
      </p>
      <ul className="mt-1 list-disc pl-5 rt-body text-sm text-[var(--ink-3)]">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </aside>
  );
}

function OptionalNote({ draft, setDraft }: DraftProps) {
  return (
    <div>
      <label className="rt-body text-sm font-medium" htmlFor="term-rationale">
        Note <span className="font-normal text-[var(--ink-3)]">(optional)</span>
      </label>
      <textarea
        id="term-rationale"
        className="mt-1 min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 rt-body"
        value={draft.rationale}
        onChange={(event) =>
          setDraft({ ...draft, rationale: event.target.value })
        }
      />
    </div>
  );
}

function submitLabel(draft: ResolutionDraft): string {
  if (draft.action === "alias") {
    return draft.targetSlug ? `Match to ${draft.targetSlug}` : "Match existing";
  }
  if (draft.action === "new_canonical") return "Create canonical item";
  return "Mark as not a term";
}

export function TermResolutionForm({
  deferred,
  draft,
  item,
  pending,
  setDraft,
  submit,
}: DraftProps &
  Readonly<{
    deferred: boolean;
    item: TermReviewQueueItem;
    pending: boolean;
    submit: (action?: ResolutionDraft["action"]) => Promise<void>;
  }>) {
  return (
    <form
      className="mt-6 space-y-4 border-t border-[var(--line)] pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ActionChoices draft={draft} item={item} setDraft={setDraft} />
      <TargetFields draft={draft} setDraft={setDraft} />
      <ReviewWarnings item={item} />
      <OptionalNote draft={draft} setDraft={setDraft} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          )}
          {submitLabel(draft)}
        </Button>
        {!deferred && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void submit("defer")}
          >
            Skip for later
          </Button>
        )}
        <span className="rt-body text-xs text-[var(--ink-3)]">
          You can undo the review decision.
        </span>
      </div>
    </form>
  );
}
