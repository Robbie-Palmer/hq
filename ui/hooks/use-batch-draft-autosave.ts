"use client";

import { useCallback, useRef, useState } from "react";
import {
  type BatchDraft,
  MutableBatchDraftSchema,
} from "recipe-domain/batch-import";
import { apiRequest } from "@/lib/api/http";
import {
  batchErrorMessage,
  type ImportBatchItem,
} from "@/lib/api/recipe-import-batches";

export function useBatchDraftAutosave(
  itemUrl: string,
  draft: BatchDraft,
  initialVersion: number,
) {
  const latest = useRef(draft);
  const saved = useRef(JSON.stringify(draft));
  const version = useRef(initialVersion);
  const pending = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const [status, setStatus] = useState("All edits saved");
  const [error, setError] = useState<string | null>(null);
  const writePendingEdits = useCallback(async () => {
    while (saved.current !== JSON.stringify(latest.current)) {
      const snapshot = JSON.stringify(latest.current);
      const validated = MutableBatchDraftSchema.parse(latest.current);
      const updated = await apiRequest<ImportBatchItem>(`${itemUrl}/draft`, {
        method: "PUT",
        json: { version: version.current, draft: validated },
      });
      version.current = updated.draftVersion;
      saved.current = snapshot;
    }
    dirty.current = false;
    setStatus("All edits saved");
    setError(null);
  }, [itemUrl]);
  const flush = useCallback(async () => {
    if (pending.current) return pending.current;
    pending.current = writePendingEdits()
      .catch((cause) => {
        setError(batchErrorMessage(cause));
        setStatus("Edits not saved");
        throw cause;
      })
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, [writePendingEdits]);
  const onChange = useCallback(
    (value: BatchDraft) => {
      latest.current = value;
      dirty.current = saved.current !== JSON.stringify(value);
      if (!dirty.current) return;
      setStatus("Saving edits...");
      void flush().catch(() => undefined);
    },
    [flush],
  );
  return { flush, onChange, version, dirty, status, error };
}
