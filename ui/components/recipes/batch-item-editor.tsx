"use client";

import type { RefObject } from "react";
import type { BatchDraft } from "recipe-domain/batch-import";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { AddRecipeView } from "@/components/recipes/add-recipe-view";
import { Button } from "@/components/ui/button";
import { useBatchDraftAcceptance } from "@/hooks/use-batch-draft-acceptance";
import { useBatchDraftAutosave } from "@/hooks/use-batch-draft-autosave";
import { useBatchEditorNavigation } from "@/hooks/use-batch-editor-navigation";
import { batchItemPath } from "@/lib/api/recipe-import-batches";

export function BatchItemEditor({
  batchId,
  itemId,
  draft,
  version,
  visibility,
  afterSave,
  flushRef,
}: Readonly<{
  batchId: string;
  itemId: string;
  draft: BatchDraft;
  version: number;
  visibility: RecipeVisibility;
  afterSave: (next: boolean) => Promise<void>;
  flushRef: RefObject<(() => Promise<void>) | null>;
}>) {
  const itemUrl = batchItemPath(batchId, itemId);
  const autosave = useBatchDraftAutosave(itemUrl, draft, version);
  const acceptance = useBatchDraftAcceptance(
    itemUrl,
    autosave.version,
    autosave.flush,
    afterSave,
  );
  useBatchEditorNavigation(
    autosave.flush,
    autosave.dirty,
    acceptance.request,
    flushRef,
  );
  return (
    <div>
      <output className="block px-4 text-sm text-[var(--ink-3)]">
        {autosave.status}
      </output>
      {autosave.error && (
        <div className="px-4">
          <p role="alert" className="text-destructive">
            {autosave.error}
          </p>
          <Button onClick={() => void autosave.flush().catch(() => undefined)}>
            Retry autosave
          </Button>
        </div>
      )}
      <AddRecipeView
        batchImport={{
          draft,
          visibility,
          onChange: autosave.onChange,
          onSave: acceptance.onSave,
        }}
      />
    </div>
  );
}
