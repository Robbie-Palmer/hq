import { parseWeddingPlan, type WeddingPlan } from "wedding-planner-domain";
import { editorStateToPlan, toEditorState } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import { parseState } from "./state";
import type { WeddingPlanDraft } from "./types";

function parseSavedJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
}

export function decodeWeddingPlan(
  saved: unknown,
  setup: AccommodationSetup = weddingAccommodationSetup,
): WeddingPlan {
  const value = typeof saved === "string" ? parseSavedJson(saved) : saved;
  if (value && typeof value === "object" && "version" in value)
    return parseWeddingPlan(value);
  return editorStateToPlan(parseState(value, setup, false));
}

export function encodeWeddingPlan(plan: WeddingPlan): string {
  return JSON.stringify(parseWeddingPlan(plan), null, 2);
}

export function decodeWeddingPlanDraft(
  saved: unknown,
  setup: AccommodationSetup = weddingAccommodationSetup,
): WeddingPlanDraft {
  return toEditorState(decodeWeddingPlan(saved, setup));
}

export function encodeWeddingPlanDraft(plan: WeddingPlanDraft): string {
  return encodeWeddingPlan(editorStateToPlan(plan));
}
