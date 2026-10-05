import { validateAccommodationSetup, type AccommodationSetup } from "./setup";
import type { Guest, Party, PlannerInput, State } from "./types";
import { validateAccommodationState } from "./validation";
function groupOvernightGuests(guests: Guest[]): Guest[][] {
  const staying = guests.filter((guest) => guest.overnight === "yes");
  const counts = new Map<string, number>();
  for (const guest of staying) {
    if (guest.fixed_bed_group_id) {
      counts.set(
        guest.fixed_bed_group_id,
        (counts.get(guest.fixed_bed_group_id) ?? 0) + 1,
      );
    }
  }
  const groups = new Map<string, Guest[]>();
  for (const guest of staying) {
    const fixed = guest.fixed_bed_group_id;
    const id = fixed && (counts.get(fixed) ?? 0) > 1 ? fixed : guest.id;
    groups.set(id, [...(groups.get(id) ?? []), guest]);
  }
  return [...groups.values()];
}

function selectedMates(
  members: Guest[],
  level: "room" | "cottage",
  guestToParty: Map<string, string>,
): Set<string> | null {
  const selected = members.filter(
    (guest) => guest[`${level}_share_mode`] === "selected",
  );
  if (!selected.length) return null;
  const choices = selected.map(
    (guest) =>
      new Set(
        guest[`may_share_${level}_with`]
          .map((id) => guestToParty.get(id))
          .filter((id): id is string => Boolean(id)),
      ),
  );
  return choices.reduce(
    (common, choice) => new Set([...common].filter((id) => choice.has(id))),
    new Set(choices[0]),
  );
}

function freeGuestIndexes(members: Guest[], state: State): number[] {
  return members.flatMap((member, index) => {
    const own = member.free_stay_reasons.length > 0;
    const partner = state.guests.some(
      (other) =>
        other.id === member.partner_id &&
        other.free_stay_reasons.length > 0 &&
        other.include_partner_in_free_stay,
    );
    return own || partner ? [index] : [];
  });
}

function bedMates(
  member: Guest,
  groups: Guest[][],
  guestToParty: Map<string, string>,
): string[] {
  if (member.requires_own_bed) return [];
  return member.may_share_bed_with
    .flatMap((id) => {
      const group = groups.find((candidate) =>
        candidate.some((guest) => guest.id === id),
      );
      const other = group?.[0];
      if (!other || group.length !== 1 || other.requires_own_bed) return [];
      if (!other.may_share_bed_with.includes(member.id)) return [];
      if (
        member.avoid_bed_with.includes(id) ||
        other.avoid_bed_with.includes(member.id)
      )
        return [];
      return guestToParty.get(id) ?? [];
    })
    .sort((first, second) => first.localeCompare(second));
}

function setSharingRules(
  party: Party,
  members: Guest[],
  state: State,
  guestToParty: Map<string, string>,
  setup: AccommodationSetup,
) {
  for (const level of ["room", "cottage"] as const) {
    let allowed = selectedMates(members, level, guestToParty);
    const reservation = setup.reservation;
    if (
      level === "cottage" &&
      reservation &&
      party.fixed_room_id === reservation.roomId
    ) {
      const approved = new Set(
        reservation
          .approvedGuestIds(state)
          .map((id) => guestToParty.get(id))
          .filter((id): id is string => Boolean(id) && id !== party.id),
      );
      allowed = allowed
        ? new Set([...allowed].filter((id) => approved.has(id)))
        : approved;
    }
    if (allowed)
      party[`allowed_${level}_mates`] = [...allowed]
        .filter((id) => id !== party.id)
        .sort((first, second) => first.localeCompare(second));
    party[`avoid_${level}_with`] = [
      ...new Set(
        members.flatMap((member) =>
          member[`avoid_${level}_with`]
            .map((id) => guestToParty.get(id))
            .filter((id): id is string => Boolean(id) && id !== party.id),
        ),
      ),
    ].sort((first, second) => first.localeCompare(second));
  }
}

function guestParty(
  members: Guest[],
  guestToParty: Map<string, string>,
  groups: Guest[][],
  state: State,
  setup: AccommodationSetup,
): Party {
  const id = guestToParty.get(members[0]!.id)!;
  const fixedRooms = new Set(
    members.map((member) => member.fixed_room_id).filter(Boolean),
  );
  if (fixedRooms.size > 1)
    throw new Error(`${id}: fixed room choices disagree`);
  const costs = members
    .map((member) => member.outside_cost_gbp)
    .filter(Boolean);
  if (costs.length > 1)
    throw new Error(`${id}: put one outside price on one guest`);
  const party: Party = {
    id,
    guests: members.map((member) => member.name),
    priority: Math.max(...members.map((member) => member.priority)),
    free_guest_indexes: freeGuestIndexes(members, state),
    requires_double_bed: members.some((member) => member.requires_own_bed),
    can_share_room: members.every(
      (member) => member.room_share_mode !== "none",
    ),
    can_share_cottage: members.every(
      (member) => member.cottage_share_mode !== "none",
    ),
    outside_cost_gbp: costs[0] || state.default_outside_cost_gbp || null,
    charge_cap_exempt: members.every((member) => member.charge_cap_exempt),
    charge_cap_exempt_guest_indexes: members.flatMap((member, index) =>
      member.charge_cap_exempt ? [index] : [],
    ),
    safe_for_our_booking: members.every(
      (member) => member.safe_for_our_booking,
    ),
    avoid_room_with: [],
    avoid_cottage_with: [],
  };
  if (fixedRooms.size) party.fixed_room_id = [...fixedRooms][0];
  if (setup.reservation?.guestIds(state).includes(members[0]!.id))
    party.fixed_room_id = setup.reservation.roomId;
  setSharingRules(party, members, state, guestToParty, setup);
  const preferred = new Set(
    members.flatMap((member) => member.preferred_property_ids),
  );
  if (preferred.size)
    party.preferred_property_ids = [...preferred].sort((first, second) =>
      first.localeCompare(second),
    );
  if (members.length === 1)
    party.can_share_bed_with = bedMates(members[0]!, groups, guestToParty);
  return party;
}

function configureProperties(input: PlannerInput, state: State) {
  for (const property of input.properties) {
    const paymentMode = state.payment_modes[property.id];
    if (paymentMode) property.charge_guests = paymentMode === "guests";
    const option = state.cottage_options[property.id];
    if (option) Object.assign(property, option);
    if (property.kind === "cottage") {
      property.paid_by_us_gbp = state.cottage_paid_by_us_gbp[property.id] ?? 0;
    }
  }
}

function partyIds(groups: Guest[][]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const group of groups) {
    const id =
      group.length > 1 && group[0]!.fixed_bed_group_id
        ? group[0]!.fixed_bed_group_id
        : group[0]!.id;
    for (const guest of group) ids.set(guest.id, id);
  }
  return ids;
}

export function buildInput(
  state: State,
  setup: AccommodationSetup,
): {
  input: PlannerInput;
  warnings: string[];
} {
  validateAccommodationSetup(setup);
  validateAccommodationState(state, setup);
  const input = structuredClone(setup.input);
  input.nights = state.nights ?? input.nights;
  input.guest_charge_cap_gbp = state.guest_charge_cap_gbp || null;
  input.max_cottage_spend_gbp = state.max_cottage_spend_gbp || null;
  input.optimization_mode = state.optimization_mode;
  for (const room of input.rooms) {
    if (room.rate_per_night_gbp !== undefined) {
      room.billing_mode = state.suite_billing_modes[room.id] ?? "by_bed";
    }
  }
  configureProperties(input, state);
  const groups = groupOvernightGuests(state.guests);
  if (groups.some((group) => group.length > 2))
    throw new Error("A bed group has more than two people");
  const guestToParty = partyIds(groups);
  if (setup.reservation) {
    const reservedGuests = setup.reservation.guestIds(state);
    const reservedGroup = guestToParty.get(reservedGuests[0] ?? "");
    if (
      !reservedGuests.length ||
      !reservedGroup ||
      reservedGuests.some((id) => guestToParty.get(id) !== reservedGroup)
    ) {
      throw new Error(
        `The existing ${setup.reservation.label} guests must share one bed`,
      );
    }
  }
  input.parties = [
    ...input.parties.map((party) => ({
      ...party,
      free_guest_indexes: party.free_guest_indexes ?? [],
      requires_double_bed: party.requires_double_bed ?? false,
      charge_cap_exempt: party.charge_cap_exempt ?? true,
      safe_for_our_booking: party.safe_for_our_booking ?? true,
    })),
    ...groups.map((members) =>
      guestParty(members, guestToParty, groups, state, setup),
    ),
  ];
  return {
    input,
    warnings: [
      `${state.guests.filter((guest) => guest.overnight === "unknown").length} overnight decisions still open`,
    ],
  };
}
