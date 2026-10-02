import { tablePairDecision, tablePlanSchema } from "./preferences";
import { orderedGuestPair } from "../core/guests";
import type { SeatingGuest, TableInput } from "./types";
export type TablePair = {
  first: SeatingGuest;
  second: SeatingGuest;
  decision: "yes" | "no";
};

function guestPairs(guests: SeatingGuest[]): TablePair[] {
  return guests.flatMap((first, index) =>
    guests.slice(index + 1).flatMap((second) => {
      const decision = tablePairDecision(first, second);
      return decision === "unset" ? [] : [{ first, second, decision }];
    }),
  );
}

function tableGroups(guests: SeatingGuest[]): SeatingGuest[][] {
  const groups = new Map<string, SeatingGuest[]>();
  for (const guest of guests) {
    // Couple keys cannot collide with individual guest IDs.
    const key = guest.partner_id
      ? `couple:${JSON.stringify(orderedGuestPair(guest.id, guest.partner_id))}`
      : `guest:${guest.id}`;
    groups.set(key, [...(groups.get(key) ?? []), guest]);
  }
  return [...groups.values()];
}

function validateGuest(
  guest: SeatingGuest,
  guests: SeatingGuest[],
  ids: Set<string>,
): void {
  if (
    guest.partner_id &&
    (guest.partner_id === guest.id ||
      !ids.has(guest.partner_id) ||
      guests.find((other) => other.id === guest.partner_id)?.partner_id !==
        guest.id)
  )
    throw new Error(
      `${guest.name}: couple relationship must identify a mutual partner`,
    );
  if (
    [
      ...(guest.prefer_table_with ?? []),
      ...(guest.avoid_table_with ?? []),
    ].some((id) => !ids.has(id) || id === guest.id)
  )
    throw new Error(`${guest.name}: table preferences have an invalid guest`);
}

function validateInput(input: TableInput): void {
  tablePlanSchema.parse(input.plan);
  const ids = new Set(input.guests.map((guest) => guest.id));
  if (ids.size !== input.guests.length)
    throw new Error("Guest IDs must be unique");
  for (const guest of input.guests) validateGuest(guest, input.guests, ids);
  for (const id of input.plan.top_table_guest_ids) {
    const guest = input.guests.find((person) => person.id === id);
    if (!guest) throw new Error("The top table refers to an unknown guest");
    if (guest.attendance !== "yes")
      throw new Error(
        `Confirm ${guest.name} is attending or remove them from the top table.`,
      );
  }
  if (
    input.plan.top_table_guest_ids.length + input.fixed_top_guests.length >
    input.plan.top_table_capacity
  )
    throw new Error(
      "The wedding party exceeds the top table capacity. Add seats or change the top table guests.",
    );
}

export function prepareTableProblem(input: TableInput) {
  validateInput(input);
  const attending = input.guests.filter((guest) => guest.attendance === "yes");
  const unknown = input.guests.filter(
    (guest) => guest.attendance === "unknown",
  );
  const top = new Set(input.plan.top_table_guest_ids);
  const otherGuests = attending.filter((guest) => !top.has(guest.id));
  const capacity = input.plan.table_capacities.reduce(
    (total, seats) => total + seats,
    0,
  );
  if (otherGuests.length > capacity)
    throw new Error(
      `${otherGuests.length} guests need seats at other tables, but there are only ${capacity}. Add tables or increase their capacities.`,
    );
  const groups = tableGroups(otherGuests);
  const groupIndex = new Map(
    groups.flatMap((group, index) =>
      group.map((guest) => [guest.id, index] as const),
    ),
  );
  const pairs = guestPairs(attending);
  for (const pair of pairs.filter((pair) => pair.decision === "no")) {
    if (top.has(pair.first.id) && top.has(pair.second.id))
      throw new Error(
        `${pair.first.name} and ${pair.second.name} must sit apart but are both fixed at the top table.`,
      );
    if (
      !top.has(pair.first.id) &&
      !top.has(pair.second.id) &&
      groupIndex.get(pair.first.id) === groupIndex.get(pair.second.id)
    )
      throw new Error(
        `${pair.first.name} and ${pair.second.name} are a confirmed couple with a keep-apart rule. Change the couple or table preference.`,
      );
  }
  return { attending, unknown, top, otherGuests, groups, groupIndex, pairs };
}
