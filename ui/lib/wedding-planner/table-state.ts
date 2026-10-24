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
import {
  chooseSeatingAlternative as chooseDomainSeatingAlternative,
  tablePairDecision as decision,
  removeSeatingAlternative as removeDomainSeatingAlternative,
  saveSeatingAlternative as saveDomainSeatingAlternative,
} from "wedding-planner-domain/seating";
import {
  defaultTablePlan,
  editDomain,
  editorStateToPlan,
} from "./editor-projection";
import type {
  Guest,
  PairDecision,
  TableAllocation,
  WeddingPlanDraft,
} from "./types";

export { tablePlanSchema } from "wedding-planner-domain/seating";

export const getTablePlan = defaultTablePlan;
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

export function lockGuestSeat(
  plan: WeddingPlanDraft,
  guestId: string,
  tableId: string,
  seatIndex?: number,
): void {
  const tables = getTablePlan(plan);
  const tableIds = new Set([
    "top",
    ...tables.table_capacities.map((_, index) => `table-${index + 1}`),
  ]);
  if (!plan.guests.some((guest) => guest.id === guestId))
    throw new Error("Choose a guest from this plan");
  if (!tableIds.has(tableId)) throw new Error("Choose an existing table");
  tables.locked_assignments ??= {};
  tables.locked_assignments[guestId] = {
    table_id: tableId,
    ...(seatIndex === undefined ? {} : { seat_index: seatIndex }),
  };
  plan.table_plan = tables;
}

export function unlockGuestSeat(plan: WeddingPlanDraft, guestId: string): void {
  const tables = getTablePlan(plan);
  delete tables.locked_assignments?.[guestId];
  for (const guestIds of Object.values(tables.locked_table_guest_ids ?? {})) {
    const index = guestIds.indexOf(guestId);
    if (index >= 0) guestIds.splice(index, 1);
  }
  plan.table_plan = tables;
}

export function setTableLock(
  plan: WeddingPlanDraft,
  allocation: TableAllocation,
  tableId: string,
  locked: boolean,
): void {
  const tables = getTablePlan(plan);
  tables.locked_table_guest_ids ??= {};
  if (locked) {
    const table = allocation.tables.find((item) => item.id === tableId);
    if (!table) throw new Error("Choose a table from the current plan");
    tables.locked_table_guest_ids[tableId] = [...table.guest_ids];
  } else {
    delete tables.locked_table_guest_ids[tableId];
  }
  plan.table_plan = tables;
}

export function saveSeatingAlternative(
  state: WeddingPlanDraft,
  allocation: TableAllocation,
  details: { id: string; name: string; created_at: string; event_id?: string },
): void {
  editDomain(state, (plan) =>
    saveDomainSeatingAlternative(plan, allocation, details),
  );
}

export function chooseSeatingAlternative(
  state: WeddingPlanDraft,
  savedPlanId: string,
): void {
  editDomain(state, (plan) =>
    chooseDomainSeatingAlternative(plan, savedPlanId),
  );
}

export function removeSeatingAlternative(
  state: WeddingPlanDraft,
  savedPlanId: string,
): void {
  editDomain(state, (plan) =>
    removeDomainSeatingAlternative(plan, savedPlanId),
  );
}
