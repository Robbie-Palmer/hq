import type { WeddingPlan } from "wedding-planner-domain";
import { editorStateToPlan } from "./editor-projection";
import type { WeddingPlanDraft } from "./types";

export function canonicalWeddingPlan(state: WeddingPlanDraft): WeddingPlan {
  return editorStateToPlan(state);
}
