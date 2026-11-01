"use client";

import { useEffect, useRef, useState } from "react";
import {
  browserPlannerApplication,
  type PlannerApplication,
} from "../application/application";
import {
  createSampleEditorPlan,
  loadEditorPlan,
} from "../application/bootstrap";
import {
  decodeWeddingPlanDraft,
  encodeWeddingPlanDraft,
} from "../application/plan-codec";
import type { WeddingPlanDraft } from "../application/types";

export interface WeddingPlanRouteState {
  state: WeddingPlanDraft | null;
  loading: boolean;
  error: string;
  update(change: (draft: WeddingPlanDraft) => void): void;
  loadSample(): Promise<void>;
  importPlan(file: File): Promise<void>;
  exportPlan(): void;
  flush(): Promise<void>;
  application: PlannerApplication;
}

export function useWeddingPlan(
  application: PlannerApplication = browserPlannerApplication,
): WeddingPlanRouteState {
  const [state, setState] = useState<WeddingPlanDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveError = useRef<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadEditorPlan(
      application,
      new URLSearchParams(window.location.search).get("demo") === "1",
    )
      .then((plan) => {
        if (active) setState(plan);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load the plan",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [application]);

  function queueSave(plan: WeddingPlanDraft): void {
    saveQueue.current = saveQueue.current
      .then(() => application.save(plan))
      .then(() => {
        saveError.current = null;
        setError("");
      })
      .catch((cause: unknown) => {
        saveError.current =
          cause instanceof Error ? cause : new Error("Could not save the plan");
        setError(saveError.current.message);
      });
  }

  function update(change: (draft: WeddingPlanDraft) => void): void {
    setState((previous) => {
      if (!previous) return previous;
      const draft = structuredClone(previous);
      try {
        change(draft);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return previous;
      }
      queueSave(draft);
      return draft;
    });
  }

  async function loadSample(): Promise<void> {
    try {
      const sample = createSampleEditorPlan();
      await application.save(sample);
      saveError.current = null;
      setState(sample);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the plan",
      );
    }
  }

  async function importPlan(file: File): Promise<void> {
    const imported = decodeWeddingPlanDraft(await file.text());
    await saveQueue.current;
    await application.save(imported);
    setState(imported);
    setError("");
  }

  function exportPlan(): void {
    if (!state) return;
    const file = new Blob([encodeWeddingPlanDraft(state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wedding-planner-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return {
    state,
    loading,
    error,
    update,
    loadSample,
    importPlan,
    exportPlan,
    flush: async () => {
      await saveQueue.current;
      if (saveError.current) throw saveError.current;
    },
    application,
  };
}
