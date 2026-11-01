import {
  setWeddingRoles as roles,
  type WeddingRole,
} from "wedding-planner-domain";
import { editDomain } from "./editor-projection";
import type { WeddingPlanDraft } from "./types";

export function setWeddingRoles(
  plan: WeddingPlanDraft,
  id: string,
  value: WeddingRole[],
): void {
  editDomain(plan, (wedding) => roles(wedding, id, value));
}
