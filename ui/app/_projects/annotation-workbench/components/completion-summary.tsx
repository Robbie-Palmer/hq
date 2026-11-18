import {
  CheckCircle2,
  ChevronRight,
  ListRestart,
  PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ReviewSummary } from "../domain/review-summary";

type CompletionSummaryProps = Readonly<{
  summary: ReviewSummary;
  totalItems: number;
  onOpenItem: (index: number) => void;
}>;

function SummaryCount({
  count,
  label,
}: Readonly<{ count: number; label: string }>) {
  return (
    <div className="rounded-xl border bg-card p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums">{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function CompletionSummary({
  summary,
  totalItems,
  onOpenItem,
}: CompletionSummaryProps) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-6">
      <CompletionCard summary={summary} totalItems={totalItems} />
      <CorrectionQueueCard summary={summary} onOpenItem={onOpenItem} />

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => onOpenItem(0)}
      >
        <ListRestart aria-hidden />
        Review all decisions
      </Button>
    </div>
  );
}

function CompletionCard({
  summary,
  totalItems,
}: Readonly<{ summary: ReviewSummary; totalItems: number }>) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="items-center px-4 text-center">
        <CheckCircle2 aria-hidden className="size-10 text-primary" />
        <h1 className="text-2xl font-semibold">Review complete</h1>
        <p className="text-sm text-muted-foreground">
          All {summary.reviewed} of {totalItems} decisions are saved.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 px-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryCount count={summary.approved} label="Approved" />
          <SummaryCount
            count={summary.needsCorrection}
            label="Need correction"
          />
          <SummaryCount count={summary.rejected} label="Rejected" />
          <SummaryCount count={summary.notNuclei} label="Not nuclei" />
          <SummaryCount count={summary.unsure} label="Unsure" />
        </div>
        <ProposalSelections summary={summary} />
      </CardContent>
    </Card>
  );
}

function ProposalSelections({ summary }: Readonly<{ summary: ReviewSummary }>) {
  if (summary.proposalSelections.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Best boundary picks</h2>
      <div className="flex flex-wrap gap-2">
        {summary.proposalSelections.map((selection) => (
          <span
            key={selection.name}
            className="rounded-full border bg-muted/40 px-3 py-1 text-sm"
          >
            {selection.name} {selection.count}
          </span>
        ))}
      </div>
    </section>
  );
}

type CorrectionEntry = ReviewSummary["correctionQueue"][number];

function CorrectionQueueEntry({
  entry,
  onOpenItem,
}: Readonly<{ entry: CorrectionEntry; onOpenItem: (index: number) => void }>) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted/50"
      onClick={() => onOpenItem(entry.itemIndex)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
        {entry.itemIndex + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {entry.needsNewBoundary
            ? "New boundary needed"
            : `${entry.proposalName ?? "Selected boundary"} needs correction`}
        </span>
        {entry.note ? (
          <span className="line-clamp-2 block text-xs text-muted-foreground">
            {entry.note}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </button>
  );
}

function CorrectionQueueCard({
  summary,
  onOpenItem,
}: Readonly<{ summary: ReviewSummary; onOpenItem: (index: number) => void }>) {
  const firstCorrection = summary.correctionQueue[0];
  if (!firstCorrection) return null;
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-4">
        <div className="flex items-center gap-2">
          <PencilLine aria-hidden className="size-5" />
          <h2 className="font-semibold">Correction queue</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          These masks need a pixel-editing pass. Your chosen starting boundaries
          and notes are saved. This viewer can reopen a review, but it cannot
          edit mask pixels yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {summary.correctionQueue.map((entry) => (
          <CorrectionQueueEntry
            key={entry.itemId}
            entry={entry}
            onOpenItem={onOpenItem}
          />
        ))}
        <Button
          type="button"
          className="w-full"
          onClick={() => onOpenItem(firstCorrection.itemIndex)}
        >
          <PencilLine aria-hidden />
          Review first flagged item
        </Button>
      </CardContent>
    </Card>
  );
}
