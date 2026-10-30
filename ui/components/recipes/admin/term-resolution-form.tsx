import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TermReviewQueueItem } from "@/lib/api/term-resolution";
import type { ResolutionDraft } from "./term-review-types";

type DraftProps = Readonly<{
  draft: ResolutionDraft;
  setDraft: (draft: ResolutionDraft) => void;
}>;

function DecisionFields({ draft, setDraft }: DraftProps) {
  const needsTarget = ["alias", "new_canonical", "merge"].includes(
    draft.action,
  );
  return (
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
  if (!item.localeReviewRequired && !item.collisionReviewRequired) return null;
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
      <DecisionFields draft={draft} setDraft={setDraft} />
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
