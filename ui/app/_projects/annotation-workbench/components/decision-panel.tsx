import { CircleCheck, CircleHelp, CircleX, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ObjectDecision, Proposal } from "../domain/review-contract";
import {
  canSaveDraft,
  chooseMask,
  chooseObject,
  chooseProposal,
  type ReviewDraft,
  rejectProposals,
} from "../domain/review-draft";

type DecisionPanelProps = Readonly<{
  draft: ReviewDraft;
  proposals: readonly Proposal[];
  saving: boolean;
  saveLabel: string;
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
    label: "Yes",
    shortcut: "1",
    icon: CircleCheck,
  },
  {
    value: "non_nucleus",
    label: "No",
    shortcut: "2",
    icon: CircleX,
  },
  { value: "uncertain", label: "Unsure", shortcut: "3", icon: CircleHelp },
];

export function DecisionPanel({
  draft,
  proposals,
  saving,
  saveLabel,
  reviewerIdIsValid,
  onChange,
  onSave,
}: DecisionPanelProps) {
  const selectedProposal = proposals.find(
    (proposal) => proposal.id === draft.selectedProposalId,
  );
  const reviewingMask = draft.objectDecision === "valid_nucleus";

  return (
    <Card className="min-w-0 gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>Make a decision</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-5 px-4">
        <ObjectDecisionFieldset draft={draft} onChange={onChange} />
        {reviewingMask ? (
          <BoundaryFieldset
            draft={draft}
            proposals={proposals}
            onChange={onChange}
          />
        ) : null}
        {selectedProposal && reviewingMask ? (
          <UseBoundaryFieldset
            draft={draft}
            proposal={selectedProposal}
            onChange={onChange}
          />
        ) : null}
        <NoteField draft={draft} onChange={onChange} />
        <SaveControls
          draft={draft}
          saving={saving}
          saveLabel={saveLabel}
          reviewerIdIsValid={reviewerIdIsValid}
          onSave={onSave}
        />
      </CardContent>
    </Card>
  );
}

type DraftControlProps = Readonly<{
  draft: ReviewDraft;
  onChange: (draft: ReviewDraft) => void;
}>;

function ObjectDecisionFieldset({ draft, onChange }: DraftControlProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        Does this crop contain a nucleus?
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {objectOptions.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={
              draft.objectDecision === option.value ? "default" : "outline"
            }
            className="min-w-0 px-2"
            onClick={() => onChange(chooseObject(draft, option.value))}
            aria-pressed={draft.objectDecision === option.value}
          >
            <option.icon aria-hidden className="size-4" />
            {option.label}
            <kbd className="hidden font-mono text-xs opacity-60 sm:inline">
              {option.shortcut}
            </kbd>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function BoundaryFieldset({
  draft,
  proposals,
  onChange,
}: DraftControlProps & Readonly<{ proposals: readonly Proposal[] }>) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        Which boundary is best?
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {proposals.map((proposal) => (
          <Button
            key={proposal.id}
            type="button"
            size="sm"
            variant={
              draft.selectedProposalId === proposal.id ? "default" : "outline"
            }
            className="min-w-0 truncate"
            aria-pressed={draft.selectedProposalId === proposal.id}
            onClick={() => onChange(chooseProposal(draft, proposal.id))}
          >
            <span className="truncate">{proposal.model_name}</span>
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={draft.maskDecision === "reject" ? "destructive" : "outline"}
          aria-pressed={draft.maskDecision === "reject"}
          onClick={() => onChange(rejectProposals(draft))}
        >
          None usable
        </Button>
      </div>
    </fieldset>
  );
}

function UseBoundaryFieldset({
  draft,
  proposal,
  onChange,
}: DraftControlProps & Readonly<{ proposal: Proposal }>) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        How should we use {proposal.model_name}?
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant={draft.maskDecision === "accept" ? "default" : "outline"}
          onClick={() => onChange(chooseMask(draft, "accept", proposal.id))}
        >
          Use as-is
        </Button>
        <Button
          type="button"
          size="sm"
          variant={draft.maskDecision === "refine" ? "default" : "outline"}
          onClick={() => onChange(chooseMask(draft, "refine", proposal.id))}
        >
          Needs correction
        </Button>
      </div>
    </fieldset>
  );
}

function NoteField({ draft, onChange }: DraftControlProps) {
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        Add note{" "}
        <span className="ml-1 font-normal text-muted-foreground">optional</span>
      </summary>
      <Textarea
        aria-label="Review note"
        className="mt-3"
        value={draft.notes}
        maxLength={4000}
        placeholder="Why does this need another pass?"
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
      />
    </details>
  );
}

function SaveControls({
  draft,
  saving,
  saveLabel,
  reviewerIdIsValid,
  onSave,
}: Readonly<{
  draft: ReviewDraft;
  saving: boolean;
  saveLabel: string;
  reviewerIdIsValid: boolean;
  onSave: () => void;
}>) {
  return (
    <>
      <Button
        type="button"
        className="sticky bottom-2 z-20 w-full shadow-lg"
        disabled={!canSaveDraft(draft) || !reviewerIdIsValid || saving}
        onClick={onSave}
      >
        <Save aria-hidden />
        {saving ? "Saving…" : saveLabel}
      </Button>
      {!reviewerIdIsValid ? (
        <p className="text-xs text-destructive">
          Reviewer name may contain letters, numbers, dots, underscores, and
          hyphens.
        </p>
      ) : null}
    </>
  );
}
