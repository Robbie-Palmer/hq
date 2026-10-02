import type { Attendance } from "wedding-planner-domain";
import {
  acceptAccommodationSeatingSuggestions as acceptSuggestions,
  setAttendance as attendance,
  setCouple as couple,
  setTablePairDecision as preference,
  seatAttendingWeddingParty as seatParty,
  accommodationSeatingSuggestions as suggestions,
  tableInput,
  setTopTableGuest as weddingParty,
} from "wedding-planner-domain";
import { tablePairDecision as decision } from "wedding-planner-domain/seating";
import {
  defaultTablePlan,
  editDomain,
  editorStateToPlan,
} from "./editor-projection";
import type { Guest, PairDecision, State } from "./types";

export { tablePlanSchema } from "wedding-planner-domain/seating";

export const getTablePlan = defaultTablePlan;
export function accommodationSeatingSuggestions(state: State) {
  return suggestions(editorStateToPlan(state));
}
export function acceptAccommodationSeatingSuggestions(
  state: State,
  pair?: [string, string],
): void {
  editDomain(state, (plan) => acceptSuggestions(plan, pair));
}
export function validateTableLinks(state: State, ids: Set<string>): void {
  if (state.table_plan?.top_table_guest_ids.some((id) => !ids.has(id)))
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
  state: State,
  first: string,
  second: string,
  choice: PairDecision,
): void {
  editDomain(state, (plan) => preference(plan, first, second, choice));
}
export function setAttendance(
  state: State,
  id: string,
  value: Attendance,
): void {
  editDomain(state, (plan) => attendance(plan, id, value));
}
export function setTopTableGuest(
  state: State,
  id: string,
  included: boolean,
): void {
  editDomain(state, (plan) => weddingParty(plan, id, included));
}
export function setCouple(state: State, id: string, partnerId: string): void {
  editDomain(state, (plan) => couple(plan, id, partnerId || null));
}
export function buildTableInput(state: State) {
  return tableInput(editorStateToPlan(state));
}

export function seatAttendingWeddingParty(state: State): void {
  editDomain(state, seatParty);
}
