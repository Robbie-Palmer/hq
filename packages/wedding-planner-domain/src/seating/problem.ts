import { DisjointSet } from "ts-base/collections";
import { tablePairDecision, tablePlanSchema } from "./preferences";
import type { SeatingGuest, TableInput } from "./types";
export type TablePair = {
  first: SeatingGuest;
  second: SeatingGuest;
  decision: "yes" | "no";
  reason: string;
  weight: number;
};

function explicitPairDecision(
  first: SeatingGuest,
  second: SeatingGuest,
): "yes" | "no" | "unset" {
  if (
    first.seating_constraints?.avoid_with.includes(second.id) ||
    second.seating_constraints?.avoid_with.includes(first.id)
  )
    return "no";
  if (
    first.seating_constraints?.prefer_with.includes(second.id) ||
    second.seating_constraints?.prefer_with.includes(first.id)
  )
    return "yes";
  return tablePairDecision(first, second);
}

function pairForGuests(
  first: SeatingGuest,
  second: SeatingGuest,
): TablePair | null {
  const decision = explicitPairDecision(first, second);
  if (decision !== "unset")
    return {
      first,
      second,
      decision,
      reason:
        decision === "yes"
          ? "They were marked as a must-sit pair"
          : "They were marked as a cannot-sit pair",
      weight: decision === "yes" ? 4 : 0,
    };
  const sameParty = Boolean(
    (first.invitation_party_id &&
      first.invitation_party_id === second.invitation_party_id) ||
      (first.source_party && first.source_party === second.source_party),
  );
  const sharedGroup = first.relationship_groups?.find((group) =>
    second.relationship_groups?.includes(group),
  );
  if (!sameParty && !sharedGroup) return null;
  return {
    first,
    second,
    decision: "yes",
    reason: sameParty
      ? "They are in the same invitation party"
      : `They share the ${sharedGroup} relationship group`,
    weight: sameParty ? 2 : 1,
  };
}

function guestPairs(guests: SeatingGuest[]): TablePair[] {
  const pairs: TablePair[] = [];
  for (const [index, first] of guests.entries())
    for (const second of guests.slice(index + 1)) {
      const pair = pairForGuests(first, second);
      if (pair) pairs.push(pair);
    }
  return pairs;
}

function joinPartners(groups: DisjointSet<string>, guests: SeatingGuest[]) {
  for (const guest of guests) {
    if (guest.partner_id && groups.has(guest.partner_id))
      groups.union(guest.id, guest.partner_id);
  }
}

function joinInvitationParties(
  groups: DisjointSet<string>,
  guests: SeatingGuest[],
) {
  const parties = new Map<string, string>();
  for (const guest of guests) {
    const party = guest.invitation_party_id || guest.source_party;
    if (!party) continue;
    const first = parties.get(party);
    if (first) groups.union(first, guest.id);
    else parties.set(party, guest.id);
  }
}

function joinRelationshipGroups(
  groups: DisjointSet<string>,
  guests: SeatingGuest[],
  relationshipGroups: string[],
) {
  for (const relationshipGroup of relationshipGroups) {
    const members = guests.filter((guest) =>
      guest.relationship_groups?.includes(relationshipGroup),
    );
    const [first, ...rest] = members;
    if (!first) continue;
    for (const guest of rest) groups.union(first.id, guest.id);
  }
}

function tableGroups(
  input: TableInput,
  guests: SeatingGuest[],
): SeatingGuest[][] {
  const groups = new DisjointSet(guests.map((guest) => guest.id));
  joinPartners(groups, guests);
  if (input.plan.keep_invitation_parties_together)
    joinInvitationParties(groups, guests);
  joinRelationshipGroups(
    groups,
    guests,
    input.plan.keep_relationship_groups_together ?? [],
  );
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  return groups
    .groups()
    .map((ids) =>
      ids
        .map((id) => byId.get(id))
        .filter((guest): guest is SeatingGuest => Boolean(guest)),
    )
    .sort((first, second) =>
      (first[0]?.id ?? "").localeCompare(second[0]?.id ?? ""),
    );
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

function validateTopTableGuests(input: TableInput) {
  for (const id of input.plan.top_table_guest_ids) {
    const guest = input.guests.find((person) => person.id === id);
    if (!guest) throw new Error("The top table refers to an unknown guest");
    if (guest.attendance !== "yes")
      throw new Error(
        `Confirm ${guest.name} is attending or remove them from the top table.`,
      );
  }
}

function tableCapacities(input: TableInput): Map<string, number> {
  return new Map<string, number>([
    ["top", input.plan.top_table_capacity],
    ...input.plan.table_capacities.map(
      (capacity, index) => [`table-${index + 1}`, capacity] as const,
    ),
  ]);
}

function validateLockedAssignments(
  input: TableInput,
  capacities: Map<string, number>,
): Set<string> {
  const lockedGuestIds = new Set<string>();
  for (const [guestId, lock] of Object.entries(
    input.plan.locked_assignments ?? {},
  )) {
    const guest = input.guests.find((person) => person.id === guestId);
    const capacity = capacities.get(lock.table_id);
    if (guest?.attendance !== "yes")
      throw new Error("Only attending guests can have locked seats");
    if (capacity === undefined)
      throw new Error(`${guest.name}: locked table does not exist`);
    if (lock.seat_index !== undefined && lock.seat_index >= capacity)
      throw new Error(
        `${guest.name}: locked seat is outside the table capacity`,
      );
    lockedGuestIds.add(guestId);
  }
  return lockedGuestIds;
}

function validateLockedTableGuest(
  input: TableInput,
  tableId: string,
  guestId: string,
  lockedGuestIds: Set<string>,
) {
  const guest = input.guests.find((person) => person.id === guestId);
  if (guest?.attendance !== "yes")
    throw new Error("Only attending guests can be locked to a table");
  if (lockedGuestIds.has(guestId)) {
    const assignment = input.plan.locked_assignments?.[guestId];
    if (assignment?.table_id !== tableId)
      throw new Error(`${guest.name}: locked to two different tables`);
  }
  lockedGuestIds.add(guestId);
}

function validateLockedTable(
  input: TableInput,
  capacities: Map<string, number>,
  lockedGuestIds: Set<string>,
  tableId: string,
  guestIds: string[],
) {
  const capacity = capacities.get(tableId);
  if (capacity === undefined)
    throw new Error(`Locked table ${tableId} does not exist`);
  if (new Set(guestIds).size !== guestIds.length)
    throw new Error(`Locked table ${tableId} contains a guest twice`);
  if (guestIds.length > capacity)
    throw new Error(`Locked table ${tableId} exceeds its capacity`);
  for (const guestId of guestIds)
    validateLockedTableGuest(input, tableId, guestId, lockedGuestIds);
}

function validateLockedTables(
  input: TableInput,
  capacities: Map<string, number>,
  lockedGuestIds: Set<string>,
) {
  for (const [tableId, guestIds] of Object.entries(
    input.plan.locked_table_guest_ids ?? {},
  ))
    validateLockedTable(input, capacities, lockedGuestIds, tableId, guestIds);
}

function validateTopTableCapacity(input: TableInput) {
  const topGuests = new Set([
    ...input.plan.top_table_guest_ids,
    ...Object.entries(input.plan.locked_assignments ?? {})
      .filter(([, lock]) => lock.table_id === "top")
      .map(([guestId]) => guestId),
    ...(input.plan.locked_table_guest_ids?.top ?? []),
  ]);
  if (
    topGuests.size + input.fixed_top_guests.length >
    input.plan.top_table_capacity
  )
    throw new Error(
      "The wedding party exceeds the top table capacity. Add seats or change the top table guests.",
    );
}

function validateInput(input: TableInput): void {
  tablePlanSchema.parse(input.plan);
  const ids = new Set(input.guests.map((guest) => guest.id));
  if (ids.size !== input.guests.length)
    throw new Error("Guest IDs must be unique");
  for (const guest of input.guests) validateGuest(guest, input.guests, ids);
  validateTopTableGuests(input);
  const capacities = tableCapacities(input);
  const lockedGuestIds = validateLockedAssignments(input, capacities);
  validateLockedTables(input, capacities, lockedGuestIds);
  validateTopTableCapacity(input);
}

function topGuestIds(input: TableInput): Set<string> {
  return new Set([
    ...input.plan.top_table_guest_ids,
    ...Object.entries(input.plan.locked_assignments ?? {})
      .filter(([, lock]) => lock.table_id === "top")
      .map(([guestId]) => guestId),
    ...(input.plan.locked_table_guest_ids?.top ?? []),
  ]);
}

function validateGuestTableCapacity(
  input: TableInput,
  otherGuests: SeatingGuest[],
) {
  const capacity = input.plan.table_capacities.reduce(
    (total, seats) => total + seats,
    0,
  );
  if (otherGuests.length > capacity)
    throw new Error(
      `${otherGuests.length} guests need seats at other tables, but there are only ${capacity}. Add tables or increase their capacities.`,
    );
}

function validatePairConflicts(
  pairs: TablePair[],
  top: Set<string>,
  groupIndex: Map<string, number>,
) {
  for (const pair of pairs.filter((pair) => pair.decision === "no")) {
    const firstAtTop = top.has(pair.first.id);
    const secondAtTop = top.has(pair.second.id);
    if (firstAtTop && secondAtTop)
      throw new Error(
        `${pair.first.name} and ${pair.second.name} must sit apart but are both fixed at the top table.`,
      );
    if (
      !firstAtTop &&
      !secondAtTop &&
      groupIndex.get(pair.first.id) === groupIndex.get(pair.second.id)
    )
      throw new Error(
        `${pair.first.name} and ${pair.second.name} are a confirmed couple with a keep-apart rule. Change the couple or table preference.`,
      );
  }
}

function forcedTables(input: TableInput): Map<string, string> {
  const forced = new Map<string, string>();
  for (const [guestId, lock] of Object.entries(
    input.plan.locked_assignments ?? {},
  ))
    forced.set(guestId, lock.table_id);
  for (const [tableId, guestIds] of Object.entries(
    input.plan.locked_table_guest_ids ?? {},
  ))
    for (const guestId of guestIds) forced.set(guestId, tableId);
  return forced;
}

function validateGroupLocks(
  groups: SeatingGuest[][],
  forcedTableByGuest: Map<string, string>,
) {
  for (const group of groups) {
    const forced = new Set(
      group
        .map((guest) => forcedTableByGuest.get(guest.id))
        .filter((tableId): tableId is string => Boolean(tableId)),
    );
    if (forced.size > 1)
      throw new Error(
        `${group.map((guest) => guest.name).join(" & ")}: grouped guests are locked to different tables`,
      );
  }
}

export function prepareTableProblem(input: TableInput) {
  validateInput(input);
  const attending = input.guests.filter((guest) => guest.attendance === "yes");
  const unknown = input.guests.filter(
    (guest) => guest.attendance === "unknown",
  );
  const top = topGuestIds(input);
  const otherGuests = attending.filter((guest) => !top.has(guest.id));
  validateGuestTableCapacity(input, otherGuests);
  const groups = tableGroups(input, otherGuests);
  const groupIndex = new Map(
    groups.flatMap((group, index) =>
      group.map((guest) => [guest.id, index] as const),
    ),
  );
  const pairs = guestPairs(attending);
  validatePairConflicts(pairs, top, groupIndex);
  const forcedTableByGuest = forcedTables(input);
  validateGroupLocks(groups, forcedTableByGuest);
  return {
    attending,
    unknown,
    top,
    otherGuests,
    groups,
    groupIndex,
    pairs,
    forcedTableByGuest,
  };
}
