import {
  type Attendance,
  acceptAccommodationSeatingSuggestions as acceptDomainAccommodationSeatingSuggestions,
  accommodationSeatingSuggestions as findAccommodationSeatingSuggestions,
  seatAttendingWeddingParty as seatDomainWeddingParty,
  setAttendance as setDomainAttendance,
  setCouple as setDomainCouple,
  setTablePairDecision as setDomainTablePairDecision,
  setTopTableGuest as setDomainTopTableGuest,
  tableInput,
} from "wedding-planner-domain";
import { tablePairDecision as decision } from "wedding-planner-domain/seating";
import { editDomain, editorStateToPlan } from "./editor-projection";
import type { Guest, PairDecision, WeddingPlanDraft } from "./types";

export { tablePlanSchema } from "wedding-planner-domain/seating";

export { defaultTablePlan as getTablePlan } from "./editor-projection";
export function accommodationSeatingSuggestions(plan: WeddingPlanDraft) {
  return findAccommodationSeatingSuggestions(editorStateToPlan(plan));
}
export function acceptAccommodationSeatingSuggestions(
  plan: WeddingPlanDraft,
  pair?: [string, string],
): void {
  editDomain(plan, (wedding) =>
    acceptDomainAccommodationSeatingSuggestions(wedding, pair),
  );
}
export function validateTableLinks(
  plan: WeddingPlanDraft,
  ids: Set<string>,
): void {
  if (plan.table_plan?.top_table_guest_ids.some((id) => !ids.has(id)))
    throw new Error("The top table refers to an unknown guest");
}
export function tablePairDecision(first: Guest, second: Guest): PairDecision {
  return decision(
    {
      ...first,
      prefer_table_with: first.prefer_table_with ?? [],
      avoid_table_with: first.avoid_table_with ?? [],
    },
    {
      ...second,
      prefer_table_with: second.prefer_table_with ?? [],
      avoid_table_with: second.avoid_table_with ?? [],
    },
  );
}
export function setTablePairDecision(
  plan: WeddingPlanDraft,
  first: string,
  second: string,
  choice: PairDecision,
): void {
  editDomain(plan, (wedding) =>
    setDomainTablePairDecision(wedding, first, second, choice),
  );
}
export function setAttendance(
  plan: WeddingPlanDraft,
  id: string,
  value: Attendance,
): void {
  editDomain(plan, (wedding) => setDomainAttendance(wedding, id, value));
}
export function setTopTableGuest(
  plan: WeddingPlanDraft,
  id: string,
  included: boolean,
): void {
  editDomain(plan, (wedding) => setDomainTopTableGuest(wedding, id, included));
}
export function setCouple(
  plan: WeddingPlanDraft,
  id: string,
  partnerId: string,
): void {
  editDomain(plan, (wedding) =>
    setDomainCouple(wedding, id, partnerId || null),
  );
}
export function buildTableInput(plan: WeddingPlanDraft) {
  return tableInput(editorStateToPlan(plan));
}

export function seatAttendingWeddingParty(plan: WeddingPlanDraft): void {
  editDomain(plan, seatDomainWeddingParty);
}
