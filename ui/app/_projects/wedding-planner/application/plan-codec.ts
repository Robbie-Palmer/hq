import { parseWeddingPlan, type WeddingPlan } from "wedding-planner-domain";
import { editorStateToPlan, toEditorState } from "./editor-projection";
import type { WeddingPlanDraft } from "./types";

function parseSavedJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
}

export function decodeWeddingPlan(saved: unknown): WeddingPlan {
  const value = typeof saved === "string" ? parseSavedJson(saved) : saved;
  return parseWeddingPlan(value);
}

export function encodeWeddingPlan(plan: WeddingPlan): string {
  return JSON.stringify(parseWeddingPlan(plan), null, 2);
}

export function decodeWeddingPlanDraft(saved: unknown): WeddingPlanDraft {
  return toEditorState(decodeWeddingPlan(saved));
}

export function encodeWeddingPlanDraft(plan: WeddingPlanDraft): string {
  return encodeWeddingPlan(editorStateToPlan(plan));
}
