"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReviewItem, ReviewSession } from "../domain/review-contract";
import { chooseProposal } from "../domain/review-draft";
import { CompletionSummary } from "./completion-summary";
import { DecisionPanel } from "./decision-panel";
import { ReviewImages } from "./review-images";
import { useAnnotationWorkbench } from "./use-annotation-workbench";

function connectionButtonLabel(
  settingsReady: boolean,
  loading: boolean,
  serviceIsConfigured: boolean,
): string {
  if (!settingsReady || loading) return "Connecting…";
  return serviceIsConfigured ? "Retry connection" : "Open review batch";
}

function ConnectionError({ error }: Readonly<{ error: string | null }>) {
  if (!error) return null;
  return (
    <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {error}
    </p>
  );
}

function ConnectionIntro({ configured }: Readonly<{ configured: boolean }>) {
  return (
    <div className="space-y-2">
      <Badge variant="outline">
        {configured ? "Configured service" : "Local development"}
      </Badge>
      <h1 className="text-2xl font-semibold tracking-tight">
        Annotation Workbench
      </h1>
      <p className="text-sm text-muted-foreground">
        {configured
          ? "Opening the review batch configured by the launcher."
          : "Connect to a local review service."}
      </p>
    </div>
  );
}

function ConnectionPanel({
  serviceIsConfigured,
  serviceUrl,
  settingsReady,
  loading,
  error,
  onServiceUrlChange,
  onConnect,
}: Readonly<{
  serviceIsConfigured: boolean;
  serviceUrl: string;
  settingsReady: boolean;
  loading: boolean;
  error: string | null;
  onServiceUrlChange: (value: string) => void;
  onConnect: () => void;
}>) {
  return (
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-muted/20 p-4">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <ConnectionIntro configured={serviceIsConfigured} />
        {serviceIsConfigured ? null : (
          <label
            htmlFor="review-service-url"
            className="grid gap-2 text-sm font-medium"
          >
            Review service URL
            <Input
              id="review-service-url"
              value={serviceUrl}
              onChange={(event) => onServiceUrlChange(event.target.value)}
            />
          </label>
        )}
        <ConnectionError error={error} />
        <Button
          type="button"
          className="w-full"
          disabled={loading || !settingsReady}
          onClick={onConnect}
        >
          <Database aria-hidden />
          {connectionButtonLabel(settingsReady, loading, serviceIsConfigured)}
        </Button>
      </div>
    </main>
  );
}

function ReviewNavigation({
  currentIndex,
  totalItems,
  completedItems,
  onPrevious,
  onNext,
}: Readonly<{
  currentIndex: number;
  totalItems: number;
  completedItems: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <nav
      className="sticky top-0 z-30 flex min-w-0 items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
      aria-label="Review item navigation"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={currentIndex === 0}
        onClick={onPrevious}
      >
        <ChevronLeft aria-label="Previous item" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            Item {currentIndex + 1} of {totalItems}
          </span>
          <span className="text-xs text-muted-foreground">
            {completedItems} reviewed
          </span>
        </div>
        <progress
          className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted [appearance:none] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
          max={totalItems}
          value={completedItems}
          aria-label="Review progress"
        />
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={currentIndex === totalItems - 1}
        onClick={onNext}
      >
        <ChevronRight aria-label="Next item" />
      </Button>
    </nav>
  );
}

function TechnicalDetails({
  session,
  item,
}: Readonly<{ session: ReviewSession; item: ReviewItem }>) {
  const licenses = item.proposals
    .map((proposal) => `${proposal.model_name}: ${proposal.model_license}`)
    .join(" · ");
  return (
    <details className="min-w-0 rounded-xl border bg-card px-4 py-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Technical details
      </summary>
      <dl className="mt-3 grid min-w-0 gap-3 text-muted-foreground sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Item</dt>
          <dd className="break-all font-mono">{item.id}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Dataset context</dt>
          <dd>
            {item.context.class_name}, site {item.context.site_id},{" "}
            {item.context.split}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Source box</dt>
          <dd className="break-words font-mono">
            [{item.context.bbox_xyxy.join(", ")}] ·{" "}
            {item.context.coordinate_space}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-foreground">Producer</dt>
          <dd className="break-words">{session.bundle.provenance.producer}</dd>
          <dd className="break-all font-mono">
            {session.bundle.provenance.producer_revision.slice(0, 12)}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-medium text-foreground">Model licenses</dt>
          <dd className="break-words">{licenses}</dd>
        </div>
      </dl>
    </details>
  );
}

export function AnnotationWorkbench() {
  const workbench = useAnnotationWorkbench();

  if (!workbench.session || !workbench.item) {
    return (
      <ConnectionPanel
        serviceIsConfigured={workbench.serviceIsConfigured}
        serviceUrl={workbench.serviceUrl}
        settingsReady={workbench.settingsReady}
        loading={workbench.loading}
        error={workbench.error}
        onServiceUrlChange={workbench.setServiceUrl}
        onConnect={() => {
          workbench.persistIdentity();
          void workbench.connect();
        }}
      />
    );
  }

  return (
    <ActiveWorkbench
      workbench={{
        ...workbench,
        session: workbench.session,
        item: workbench.item,
      }}
    />
  );
}

type ActiveWorkbenchProps = Readonly<{
  workbench: ReturnType<typeof useAnnotationWorkbench> & {
    session: ReviewSession;
    item: ReviewItem;
  };
}>;

function ActiveWorkbench({ workbench }: ActiveWorkbenchProps) {
  const { session } = workbench;
  return (
    <main className="min-h-dvh w-full max-w-full overflow-x-hidden bg-muted/20">
      <WorkbenchHeader workbench={workbench} />

      {workbench.showCompletion && workbench.reviewSummary ? (
        <CompletionSummary
          summary={workbench.reviewSummary}
          totalItems={session.bundle.items.length}
          onOpenItem={(index) => {
            workbench.setCurrentIndex(index);
            workbench.setShowCompletion(false);
          }}
        />
      ) : (
        <ReviewWorkspace workbench={workbench} />
      )}
    </main>
  );
}

function WorkbenchHeader({ workbench }: ActiveWorkbenchProps) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <h1 className="mr-auto font-semibold">Annotation Workbench</h1>
        <label
          htmlFor="annotation-reviewer-name"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          Reviewer
          <Input
            id="annotation-reviewer-name"
            aria-label="Reviewer name"
            aria-invalid={!workbench.reviewerIdIsValid}
            className="h-8 w-32"
            value={workbench.reviewerId}
            onChange={(event) => workbench.setReviewerId(event.target.value)}
            onBlur={workbench.persistIdentity}
          />
        </label>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => void workbench.connect()}
        >
          <RefreshCw aria-label="Reload review batch" />
        </Button>
      </div>
    </header>
  );
}

function ReviewWorkspace({ workbench }: ActiveWorkbenchProps) {
  const { session, item } = workbench;
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-3 p-3 sm:p-4">
      <ReviewNavigation
        currentIndex={workbench.currentIndex}
        totalItems={session.bundle.items.length}
        completedItems={workbench.completedItems.size}
        onPrevious={() =>
          workbench.setCurrentIndex((index) => Math.max(0, index - 1))
        }
        onNext={() =>
          workbench.setCurrentIndex((index) =>
            Math.min(session.bundle.items.length - 1, index + 1),
          )
        }
      />
      <ReviewColumns workbench={workbench} />
      <TechnicalDetails session={session} item={item} />
    </div>
  );
}

function ReviewColumns({ workbench }: ActiveWorkbenchProps) {
  const { session, item, draft } = workbench;
  const saveLabel = workbench.currentReview
    ? "Save changes"
    : workbench.completedItems.size === session.bundle.items.length - 1
      ? "Save and finish"
      : "Save and next";
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <ReviewImages
        serviceUrl={workbench.serviceUrl}
        session={session}
        item={item}
        proposals={item.proposals}
        selectedProposalId={draft.selectedProposalId}
        opacity={workbench.opacity}
        showReference={workbench.showReference}
        onSelectProposal={(proposalId) =>
          workbench.setDraft((current) => chooseProposal(current, proposalId))
        }
        onOpacityChange={workbench.setOpacity}
        onReferenceChange={() =>
          workbench.setShowReference((visible) => !visible)
        }
      />
      <aside className="min-w-0 space-y-3">
        <DecisionPanel
          draft={draft}
          proposals={item.proposals}
          saving={workbench.saving}
          saveLabel={saveLabel}
          reviewerIdIsValid={workbench.reviewerIdIsValid}
          onChange={workbench.setDraft}
          onSave={() => void workbench.submitReview()}
        />
        {workbench.error ? (
          <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {workbench.error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
