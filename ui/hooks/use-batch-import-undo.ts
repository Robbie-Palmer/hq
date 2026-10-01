"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/http";
import {
  batchErrorMessage,
  recipeImportBatchesPath,
} from "@/lib/api/recipe-import-batches";

export type BatchUndo = {
  state: string;
  items: { itemId: string; label: string; outcome: string; message: string }[];
};
export function useBatchImportUndo(batchId: string) {
  const [preview, setPreview] = useState<BatchUndo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `${recipeImportBatchesPath}/${batchId}/undo`;
  const polling = preview?.state === "running";
  useEffect(() => {
    if (!polling) return;
    let active = true;
    const interval = window.setInterval(() => {
      apiRequest<BatchUndo>(path)
        .then((value) => {
          if (active) setPreview(value);
        })
        .catch((cause) => {
          if (active) setError(batchErrorMessage(cause));
        });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [path, polling]);
  async function perform(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (start)
        await apiRequest(path, { method: "PUT", json: { state: "started" } });
      setPreview(await apiRequest<BatchUndo>(path));
    } catch (cause) {
      setError(batchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return {
    preview,
    busy,
    error,
    check: () => perform(false),
    start: () => perform(true),
  };
}
