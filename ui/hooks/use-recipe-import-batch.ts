"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api/http";
import {
  batchErrorMessage,
  recipeImportBatchesPath as endpoint,
  type ImportBatch,
  type ImportBatchSummary,
  startImportBatch,
  updateBatchItemReview,
} from "@/lib/api/recipe-import-batches";

function updateLocation(id: string, itemId: string | null) {
  const params = new URLSearchParams({ batch: id });
  if (itemId) params.set("item", itemId);
  window.history.replaceState(null, "", `/recipes/import?${params}`);
}
function nextReviewItem(batch: ImportBatch, selected: string | null) {
  const currentIndex = batch.items.findIndex((value) => value.id === selected);
  const ordered = [
    ...batch.items.slice(currentIndex + 1),
    ...batch.items.slice(0, currentIndex),
  ];
  return ordered.find(
    (value) =>
      value.reviewState === "ready" || value.reviewState === "needs_attention",
  );
}

export function useRecipeImportBatch(userId: string | undefined) {
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const batchId = batch?.id;
  const item = batch?.items.find((value) => value.id === selected);
  const load = useCallback(async (id: string) => {
    const value = await apiRequest<ImportBatch>(`${endpoint}/${id}`);
    setBatch(value);
    return value;
  }, []);
  useEffect(() => {
    setBatch(null);
    setBatches([]);
    setSelected(null);
    if (!userId) return;
    let active = true;
    apiRequest<{ batches: ImportBatchSummary[] }>(endpoint)
      .then((result) => {
        if (active) setBatches(result.batches);
      })
      .catch((cause) => {
        if (active) setError(batchErrorMessage(cause));
      });
    const params = new URLSearchParams(window.location.search);
    const id = params.get("batch");
    if (id)
      apiRequest<ImportBatch>(`${endpoint}/${id}`)
        .then((value) => {
          if (!active) return;
          setBatch(value);
          setSelected(params.get("item") ?? value.items[0]?.id ?? null);
        })
        .catch((cause) => {
          if (active) setError(batchErrorMessage(cause));
        });
    return () => {
      active = false;
    };
  }, [userId]);
  useEffect(() => {
    if (!batchId) return;
    let active = true;
    const interval = window.setInterval(() => {
      apiRequest<ImportBatch>(`${endpoint}/${batchId}`)
        .then((value) => {
          if (active) setBatch(value);
        })
        .catch((cause) => {
          if (active) setError(batchErrorMessage(cause));
        });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [batchId]);
  async function perform(operation: () => void | Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await flushRef.current?.();
      await operation();
    } catch (cause) {
      setError(batchErrorMessage(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    return perform(() => {
      setSelected(id);
      if (batchId) updateLocation(batchId, id);
    });
  }
  function resume(id: string) {
    return perform(async () => {
      await startImportBatch(id);
      const value = await load(id);
      const first =
        value.items.find((value) => value.reviewState === "ready") ??
        value.items[0];
      setSelected(first?.id ?? null);
      updateLocation(id, first?.id ?? null);
      setBatches((result) => [
        { id: value.id, createdAt: value.createdAt },
        ...result.filter((value) => value.id !== id),
      ]);
    });
  }
  function action(action: "retry" | "skip") {
    return perform(async () => {
      if (!batch || !item) return;
      await updateBatchItemReview(batch.id, item.id, action);
      await load(batch.id);
    });
  }
  async function afterSave(next: boolean) {
    if (!batch) return;
    const value = await load(batch.id);
    if (!next) return;
    const following = nextReviewItem(value, selected);
    setSelected(following?.id ?? null);
    updateLocation(batch.id, following?.id ?? null);
  }
  return {
    batch,
    batches,
    selected,
    item,
    error,
    busy,
    flushRef,
    choose,
    resume,
    action,
    afterSave,
  };
}
