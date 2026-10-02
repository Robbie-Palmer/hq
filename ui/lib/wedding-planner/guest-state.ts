import {
  setWeddingRoles as roles,
  type WeddingRole,
} from "wedding-planner-domain";
import { editDomain } from "./editor-projection";
import type { State } from "./types";

export function setWeddingRoles(
  state: State,
  id: string,
  value: WeddingRole[],
): void {
  editDomain(state, (plan) => roles(plan, id, value));
}
