"use client";

import type { RefObject } from "react";
import { BatchImportCapture } from "@/components/recipes/batch-import-capture";
import { BatchItemEditor } from "@/components/recipes/batch-item-editor";
import { RecipeAuthRequired } from "@/components/recipes/recipe-auth-required";
import { Button } from "@/components/ui/button";
import { useRecipeImportBatch } from "@/hooks/use-recipe-import-batch";
import type {
  ImportBatch,
  ImportBatchItem,
} from "@/lib/api/recipe-import-batches";
import { authClient } from "@/lib/auth-client";

function BatchQueue({
  batch,
  selected,
  busy,
  choose,
}: Readonly<{
  batch: ImportBatch;
  selected: string | null;
  busy: boolean;
  choose: (id: string) => Promise<void>;
}>) {
  return (
    <nav aria-label="Batch recipes" className="my-4 flex flex-wrap gap-2">
      {batch.items.map((item) => (
        <Button
          key={item.id}
          variant={item.id === selected ? "default" : "outline"}
          className="max-w-full"
          disabled={busy}
          onClick={() => void choose(item.id).catch(() => undefined)}
        >
          <span className="truncate">{item.sourceLabel}</span> ·{" "}
          {item.reviewState === "waiting" ? item.status : item.reviewState}
        </Button>
      ))}
    </nav>
  );
}
function canSkip(item: ImportBatchItem) {
  return (
    !["accepted", "skipped"].includes(item.reviewState) &&
    !["queued", "running"].includes(item.status)
  );
}
function BatchItemReview({
  batch,
  item,
  busy,
  action,
  afterSave,
  flushRef,
}: Readonly<{
  batch: ImportBatch;
  item: ImportBatchItem;
  busy: boolean;
  action: (action: "skip" | "retry") => Promise<void>;
  afterSave: (next: boolean) => Promise<void>;
  flushRef: RefObject<(() => Promise<void>) | null>;
}>) {
  return (
    <>
      {item.errorMessage && (
        <p role="alert" className="my-3 text-destructive">
          {item.errorMessage}
        </p>
      )}
      {canSkip(item) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action("skip").catch(() => undefined)}
          >
            Skip
          </Button>
          {item.status === "failed" && item.errorType !== "PreflightError" && (
            <Button
              disabled={busy}
              onClick={() => void action("retry").catch(() => undefined)}
            >
              Retry import
            </Button>
          )}
        </div>
      )}
      {item.reviewState === "ready" && item.draft && (
        <BatchItemEditor
          key={item.id}
          batchId={batch.id}
          itemId={item.id}
          draft={item.draft}
          version={item.draftVersion}
          visibility={batch.visibility}
          afterSave={afterSave}
          flushRef={flushRef}
        />
      )}
    </>
  );
}
function BatchProgress({ batch }: Readonly<{ batch: ImportBatch }>) {
  return (
    <p role="status" className="my-3 text-sm">
      {batch.counts.processing} processing · {batch.counts.ready} ready ·{" "}
      {batch.counts.failed} failed · {batch.counts.accepted} saved ·{" "}
      {batch.counts.skipped} skipped
    </p>
  );
}

export function BatchRecipeImport() {
  const { data: session, isPending } = authClient.useSession();
  const workspace = useRecipeImportBatch(session?.user.id);
  if (isPending)
    return (
      <p role="status" className="p-6">
        Loading imports...
      </p>
    );
  if (!session)
    return (
      <RecipeAuthRequired
        title="Log in to import recipes"
        description="Your batch progress and edits stay in your account."
      />
    );
  const {
    batch,
    batches,
    item,
    busy,
    selected,
    choose,
    resume,
    action,
    afterSave,
    flushRef,
  } = workspace;
  return (
    <main className="container mx-auto max-w-[1600px] px-4 py-6">
      <h1 className="rt-display text-4xl">Import recipes</h1>
      {workspace.error && (
        <p role="alert" className="my-3 text-destructive">
          {workspace.error}
        </p>
      )}
      <BatchImportCapture hasBatch={Boolean(batch)} onStart={resume} />
      {batches.length > 0 && (
        <details className="my-4">
          <summary>Resume a batch</summary>
          <ul>
            {batches.map((value) => (
              <li key={value.id}>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void resume(value.id).catch(() => undefined)}
                >
                  {new Date(value.createdAt).toLocaleString()} ·{" "}
                  {value.id.slice(0, 8)}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {batch && (
        <>
          <BatchProgress batch={batch} />
          {batch.counts.processing > 0 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void resume(batch.id).catch(() => undefined)}
            >
              Resume processing
            </Button>
          )}
          <BatchQueue
            batch={batch}
            selected={selected}
            busy={busy}
            choose={choose}
          />
          {item && (
            <BatchItemReview
              batch={batch}
              item={item}
              busy={busy}
              action={action}
              afterSave={afterSave}
              flushRef={flushRef}
            />
          )}
        </>
      )}
    </main>
  );
}
