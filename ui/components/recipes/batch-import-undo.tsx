"use client";

import { Button } from "@/components/ui/button";
import { useBatchImportUndo } from "@/hooks/use-batch-import-undo";
import type { ImportBatch } from "@/lib/api/recipe-import-batches";

export function BatchImportUndo({
  batch,
  busy,
}: Readonly<{ batch: ImportBatch; busy: boolean }>) {
  const undo = useBatchImportUndo(batch.id);
  const results = undo.preview?.items ?? [];
  const eligible = results.filter((item) => item.outcome === "eligible").length;
  const failed = results.filter((item) => item.outcome === "failed").length;
  return (
    <section
      className="my-4 rounded-lg border border-[var(--line)] p-4"
      aria-label="Undo collection import"
    >
      <p className="my-2 text-sm">
        Undo removes accepted recipes from this batch. Transferred, forked,
        changed, or used recipes are left intact.
      </p>
      <Button
        variant="outline"
        disabled={busy || undo.busy || batch.counts.processing > 0}
        onClick={() => void undo.check()}
      >
        Preview batch undo
      </Button>
      {undo.error && (
        <p role="alert" className="my-2 text-destructive">
          {undo.error}
        </p>
      )}
      {undo.preview && (
        <>
          <output className="my-2 block text-sm">
            {eligible} to delete ·{" "}
            {results.filter((item) => item.outcome === "deleted").length}{" "}
            deleted ·{" "}
            {results.filter((item) => item.outcome === "preserved").length}{" "}
            preserved · {failed} failed
          </output>
          <ul className="my-2 text-sm">
            {results.map((item) => (
              <li key={item.itemId}>
                {item.label}: {item.message}
              </li>
            ))}
          </ul>
          {(eligible > 0 || failed > 0 || undo.preview.state === "running") && (
            <Button
              variant="destructive"
              disabled={busy || undo.busy}
              onClick={() => void undo.start()}
            >
              {undo.preview.state === "preview"
                ? "Confirm batch undo"
                : "Resume batch undo"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
