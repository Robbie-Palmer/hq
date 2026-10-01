import { z } from "zod";
import {
  type AccommodationSetup,
  validateAccommodationSetup,
  weddingAccommodationSetup,
} from "./setup";
import type { Guest, Party, PlannerInput, State } from "./types";

const idList = z.array(z.string());
const money = z.union([z.string(), z.number()]).transform(String);
const guestSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  source_party: z.string().default(""),
  tags: z.string().default(""),
  overnight: z.enum(["unknown", "yes", "no"]),
  fixed_bed_group_id: z.string().default(""),
  requires_own_bed: z.boolean().default(false),
  safe_for_our_booking: z.boolean().default(false),
  may_share_bed_with: idList.default([]),
  avoid_bed_with: idList.default([]),
  can_share_room: z.boolean().default(false),
  room_share_mode: z.enum(["none", "selected", "any"]).default("none"),
  may_share_room_with: idList.default([]),
  can_share_cottage: z.boolean().default(true),
  cottage_share_mode: z.enum(["none", "selected", "any"]).default("any"),
  may_share_cottage_with: idList.default([]),
  avoid_room_with: idList.default([]),
  avoid_cottage_with: idList.default([]),
  priority: z.number().int().min(0).default(3),
  fixed_room_id: z.string().default(""),
  preferred_property_ids: idList.default([]),
  outside_cost_gbp: z.string().default(""),
  charge_cap_exempt: z.boolean().default(false),
  free_stay_reasons: z
    .array(z.enum(["immediate_family", "wedding_party", "other"]))
    .default([]),
  include_partner_in_free_stay: z.boolean().default(true),
});

const cottageChoice = z.object({
  availability: z.enum(["unknown", "available", "unavailable"]),
  booking_by: z.enum(["guests", "couple"]),
});

const stateSchema = z.looseObject({
  nights: z.number().int().positive().default(1),
  guests: z.array(guestSchema).min(1),
  payment_modes: z.record(z.string(), z.enum(["couple", "guests"])),
  cottage_options: z.record(z.string(), cottageChoice),
  cottage_paid_by_us_gbp: z.record(z.string(), money),
  reviewed_non_couples: z.array(z.tuple([z.string(), z.string()])).default([]),
  reservations: z
    .record(
      z.string(),
      z.object({ guest_ids: idList, approved_guest_ids: idList }),
    )
    .default({}),
  suite_billing_modes: z.record(z.string(), z.string()).default({}),
  guest_charge_cap_gbp: z.string().default(""),
  max_cottage_spend_gbp: z.string().default(""),
  default_outside_cost_gbp: z.string().default(""),
  optimization_mode: z
    .enum(["priority_first", "lowest_total_price"])
    .default("priority_first"),
});

export function moneyPence(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isInteger(amount * 100)
  ) {
    throw new Error(`${label} must be a non-negative amount in whole pence`);
  }
  return Math.round(amount * 100);
}

export function pounds(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function migrateLegacyReservation(
  parsed: z.infer<typeof stateSchema>,
  setup: AccommodationSetup,
): State {
  const legacy = setup.reservation?.legacyFields;
  const roomId = setup.reservation?.roomId;
  const reservations = { ...parsed.reservations };
  if (roomId && legacy && !reservations[roomId]) {
    const legacyData = parsed as Record<string, unknown>;
    const guestIds = legacyData[legacy.guestIds];
    const approvedGuestIds = legacyData[legacy.approvedGuestIds];
    if (stringList(guestIds)) {
      reservations[roomId] = {
        guest_ids: guestIds,
        approved_guest_ids: stringList(approvedGuestIds)
          ? approvedGuestIds
          : [],
      };
    }
  }
  const normalized = { ...parsed, reservations } as State;
  if (legacy) {
    delete normalized[legacy.guestIds];
    delete normalized[legacy.approvedGuestIds];
  }
  return normalized;
}

function validateGuestLinks(state: State, ids: Set<string>): void {
  for (const guest of state.guests) {
    for (const field of [
      "may_share_bed_with",
      "avoid_bed_with",
      "may_share_room_with",
      "may_share_cottage_with",
      "avoid_room_with",
      "avoid_cottage_with",
    ] as const) {
      if (guest[field].some((id) => !ids.has(id) || id === guest.id))
        throw new Error(`${guest.name}: ${field} has an invalid guest`);
    }
  }
}

function validateReservations(
  state: State,
  ids: Set<string>,
  setup: AccommodationSetup,
): void {
  const rooms = new Set(setup.input.rooms.map((room) => room.id));
  for (const [roomId, reservation] of Object.entries(state.reservations)) {
    if (!rooms.has(roomId))
      throw new Error(`${roomId} reservation refers to an unknown room`);
    if (
      [...reservation.guest_ids, ...reservation.approved_guest_ids].some(
        (id) => !ids.has(id),
      )
    )
      throw new Error(`${roomId} reservation has an invalid guest`);
  }
  if (setup.reservation && !setup.reservation.guestIds(state).length)
    throw new Error(`Choose the existing ${setup.reservation.label} guests`);
}

export function parseState(
  value: unknown,
  setup: AccommodationSetup = weddingAccommodationSetup,
): State {
  const checked = stateSchema.safeParse(value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const field = issue?.path.join(".") || "file";
    throw new Error(
      `This file is not a compatible wedding planner plan (${field}: ${issue?.message ?? "invalid data"}).`,
    );
  }
  const normalized = migrateLegacyReservation(checked.data, setup);
  if (setup.fixedNights && normalized.nights !== setup.fixedNights)
    throw new Error(`This plan must cover ${setup.fixedNights} night(s)`);
  const ids = new Set(normalized.guests.map((guest) => guest.id));
  if (ids.size !== normalized.guests.length)
    throw new Error("Guest IDs must be unique");
  validateGuestLinks(normalized, ids);
  validateReservations(normalized, ids, setup);
  for (const [id, paid] of Object.entries(normalized.cottage_paid_by_us_gbp)) {
    moneyPence(paid, `${id} already paid`);
  }
  return normalized;
}

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

function freeGuestIndexes(members: Guest[]): number[] {
  return members.flatMap((member, index) => {
    const own = member.free_stay_reasons.length > 0;
    const partner = members.some(
      (other) =>
        other.id !== member.id &&
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
    free_guest_indexes: freeGuestIndexes(members),
    requires_double_bed: members.some((member) => member.requires_own_bed),
    can_share_room: members.every(
      (member) => member.room_share_mode !== "none",
    ),
    can_share_cottage: members.every(
      (member) => member.cottage_share_mode !== "none",
    ),
    outside_cost_gbp: costs[0] || state.default_outside_cost_gbp || null,
    charge_cap_exempt: members.some((member) => member.charge_cap_exempt),
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
  setup: AccommodationSetup = weddingAccommodationSetup,
): {
  input: PlannerInput;
  warnings: string[];
} {
  validateAccommodationSetup(setup);
  state = parseState(state, setup);
  const input = structuredClone(setup.input);
  input.nights = state.nights ?? input.nights;
  input.guest_charge_cap_gbp = state.guest_charge_cap_gbp || null;
  input.max_cottage_spend_gbp = state.max_cottage_spend_gbp || null;
  input.optimization_mode =
    state.optimization_mode as PlannerInput["optimization_mode"];
  for (const room of input.rooms) {
    if (room.rate_per_night_gbp !== undefined) {
      room.billing_mode = (state.suite_billing_modes[room.id] ??
        "by_bed") as typeof room.billing_mode;
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
