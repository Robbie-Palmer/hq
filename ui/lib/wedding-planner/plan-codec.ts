import { parseWeddingPlan, type WeddingPlan } from "wedding-planner-domain";
import { editorStateToPlan } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import { parseState } from "./state";

export function decodeWeddingPlan(
  value: unknown,
  setup: AccommodationSetup = weddingAccommodationSetup,
): WeddingPlan {
  if (value && typeof value === "object" && "version" in value)
    return parseWeddingPlan(value);
  return editorStateToPlan(parseState(value, setup, false));
}

export function encodeWeddingPlan(plan: WeddingPlan): string {
  return JSON.stringify(parseWeddingPlan(plan), null, 2);
}
