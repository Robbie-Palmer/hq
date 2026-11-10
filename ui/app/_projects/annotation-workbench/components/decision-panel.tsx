import { CircleCheck, CircleHelp, CircleX, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ObjectDecision, Proposal } from "../domain/review-contract";
import {
  canSaveDraft,
  chooseMask,
  chooseObject,
  type ReviewDraft,
} from "../domain/review-draft";

type DecisionPanelProps = Readonly<{
  draft: ReviewDraft;
  proposals: readonly Proposal[];
  selectedProposal: Proposal;
  saving: boolean;
  reviewerIdIsValid: boolean;
  onChange: (draft: ReviewDraft) => void;
  onSave: () => void;
}>;

const objectOptions: readonly {
  value: ObjectDecision;
  label: string;
  shortcut: string;
  icon: typeof CircleCheck;
}[] = [
  {
    value: "valid_nucleus",
    label: "Valid nucleus",
    shortcut: "1",
    icon: CircleCheck,
  },
  {
    value: "non_nucleus",
    label: "Not a nucleus",
    shortcut: "2",
    icon: CircleX,
  },
  { value: "uncertain", label: "Uncertain", shortcut: "3", icon: CircleHelp },
];

export function DecisionPanel({
  draft,
  proposals,
  selectedProposal,
  saving,
  reviewerIdIsValid,
  onChange,
  onSave,
}: DecisionPanelProps) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>Review decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            1. Does the box contain a nucleus?
          </legend>
          <div className="grid gap-2">
            {objectOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={
                  draft.objectDecision === option.value ? "default" : "outline"
                }
                className="justify-between"
                onClick={() => onChange(chooseObject(draft, option.value))}
                aria-pressed={draft.objectDecision === option.value}
              >
                <span className="flex items-center gap-2">
                  <option.icon aria-hidden className="size-4" />
                  {option.label}
                </span>
                <kbd className="font-mono text-xs opacity-60">
                  {option.shortcut}
                </kbd>
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset
          className="space-y-2"
          disabled={draft.objectDecision !== "valid_nucleus"}
        >
          <legend className="mb-2 text-sm font-medium">
            2. What should happen to the mask?
          </legend>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              size="sm"
              variant={draft.maskDecision === "accept" ? "default" : "outline"}
              onClick={() =>
                onChange(chooseMask(draft, "accept", selectedProposal.id))
              }
            >
              Accept <kbd className="font-mono text-xs opacity-60">A</kbd>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={draft.maskDecision === "refine" ? "default" : "outline"}
              onClick={() =>
                onChange(chooseMask(draft, "refine", selectedProposal.id))
              }
            >
              Refine <kbd className="font-mono text-xs opacity-60">F</kbd>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={
                draft.maskDecision === "reject" ? "destructive" : "outline"
              }
              onClick={() =>
                onChange(chooseMask(draft, "reject", selectedProposal.id))
              }
            >
              Reject <kbd className="font-mono text-xs opacity-60">R</kbd>
            </Button>
          </div>
          {draft.maskDecision === "refine" ? (
            <p className="text-xs text-muted-foreground">
              Refinement is queued with the selected proposal. Brush editing is
              the next iteration.
            </p>
          ) : null}
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="review-notes" className="text-sm font-medium">
            Notes
          </label>
          <Textarea
            id="review-notes"
            value={draft.notes}
            maxLength={4000}
            placeholder="Record why the box or boundary needs another pass."
            onChange={(event) =>
              onChange({ ...draft, notes: event.target.value })
            }
          />
        </div>

        <Button
          type="button"
          className="w-full"
          disabled={
            !canSaveDraft(draft) ||
            !reviewerIdIsValid ||
            saving ||
            proposals.length === 0
          }
          onClick={onSave}
        >
          <Save aria-hidden />
          {saving ? "Saving…" : "Save and continue"}
        </Button>
        {!reviewerIdIsValid ? (
          <p className="text-xs text-destructive">
            Reviewer ID may contain letters, numbers, dots, underscores, and
            hyphens.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
