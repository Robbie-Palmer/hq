"use client";

import { type RefObject, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/api/http";
import type { BatchRecipeSave } from "@/lib/api/recipe-import-batches";

export function useBatchDraftAcceptance(
  itemUrl: string,
  version: RefObject<number>,
  flush: () => Promise<void>,
  afterSave: (next: boolean) => Promise<void>,
) {
  const request = useRef<{
    key: string;
    version: number;
    recipe: BatchRecipeSave;
  } | null>(null);
  const onSave = useCallback(
    async (recipe: BatchRecipeSave, next: boolean) => {
      // Retain the exact request after a lost response so the receipt can be replayed.
      if (!request.current) {
        await flush();
        request.current = {
          key: crypto.randomUUID(),
          version: version.current,
          recipe,
        };
      }
      const current = request.current;
      await apiRequest(`${itemUrl}/acceptance`, {
        method: "PUT",
        json: {
          idempotencyKey: current.key,
          version: current.version,
          recipe: current.recipe,
        },
      });
      request.current = null;
      await afterSave(next);
    },
    [itemUrl, version, flush, afterSave],
  );
  return { onSave, request };
}
