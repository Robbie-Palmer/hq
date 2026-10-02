import {
  partnerId,
  weddingRolesSchema,
  isWeddingPartyMember,
  type Attendance,
  type WeddingRole,
} from "./core/guests";
import { setBedPartner } from "./accommodation/sharing";
import { accommodationPreferencesSchema } from "./accommodation/preferences";
import type { WeddingPlan } from "./plan";
import { accommodationState } from "./projections";
import { seatingPreferencesSchema } from "./seating/preferences";
import type { PairDecision } from "./values";

function requireGuest(plan: WeddingPlan, id: string) {
  const guest = plan.guests.find((person) => person.id === id);
  if (!guest) throw new Error(`Unknown guest: ${id}`);
  return guest;
}

export function setAttendance(
  plan: WeddingPlan,
  id: string,
  attendance: Attendance,
): void {
  requireGuest(plan, id).attendance = attendance;
  if (attendance !== "yes")
    plan.seating.top_table_guest_ids = plan.seating.top_table_guest_ids.filter(
      (other) => other !== id,
    );
}

export function setTopTableGuest(
  plan: WeddingPlan,
  id: string,
  included: boolean,
): void {
  const guest = requireGuest(plan, id);
  if (included && guest.attendance !== "yes")
    throw new Error(
      `Confirm ${guest.name} is attending before adding them to the top table.`,
    );
  plan.seating.top_table_guest_ids = plan.seating.top_table_guest_ids.filter(
    (other) => other !== id,
  );
  if (included) plan.seating.top_table_guest_ids.push(id);
}

export function setWeddingRoles(
  plan: WeddingPlan,
  id: string,
  roles: WeddingRole[],
): void {
  requireGuest(plan, id).wedding_roles = weddingRolesSchema.parse(roles);
}

export function seatAttendingWeddingParty(plan: WeddingPlan): void {
  plan.seating.top_table_guest_ids = [
    ...new Set([
      ...plan.seating.top_table_guest_ids,
      ...plan.guests
        .filter(
          (guest) => guest.attendance === "yes" && isWeddingPartyMember(guest),
        )
        .map((guest) => guest.id),
    ]),
  ];
}

export function setCouple(
  plan: WeddingPlan,
  id: string,
  partner: string | null,
): void {
  requireGuest(plan, id);
  if (partner !== null) {
    requireGuest(plan, partner);
    if (id === partner) throw new Error("A guest cannot be their own partner");
    const existing = partnerId(plan.couples, partner);
    if (existing && existing !== id)
      throw new Error("That guest already has a partner");
  }
  plan.couples = plan.couples.filter(
    (couple) => !couple.guest_ids.includes(id),
  );
  if (partner !== null) {
    const guestIds = [id, partner].sort() as [string, string];
    plan.couples.push({ id: JSON.stringify(guestIds), guest_ids: guestIds });
    plan.reviewed_non_couples = plan.reviewed_non_couples.filter(
      (pair) => !(pair.includes(id) && pair.includes(partner)),
    );
  }
}

export function markNotCouple(
  plan: WeddingPlan,
  first: string,
  second: string,
  notCouple: boolean,
): void {
  requireGuest(plan, first);
  requireGuest(plan, second);
  if (first === second) throw new Error("Choose two different guests");
  plan.reviewed_non_couples = plan.reviewed_non_couples.filter(
    (pair) => !(pair.includes(first) && pair.includes(second)),
  );
  if (notCouple) {
    if (partnerId(plan.couples, first) === second) setCouple(plan, first, null);
    plan.reviewed_non_couples.push([first, second]);
  }
}

export function confirmCoupleSharingBed(
  plan: WeddingPlan,
  first: string,
  second: string,
): void {
  requireGuest(plan, first);
  requireGuest(plan, second);
  const state = accommodationState(plan);
  const a = accommodationPreferencesSchema.parse(
    plan.accommodation.guests[first] ?? {},
  );
  const b = accommodationPreferencesSchema.parse(
    plan.accommodation.guests[second] ?? {},
  );
  if (a.requires_own_bed || b.requires_own_bed || b.fixed_bed_group_id)
    throw new Error("Change their bed choices before assigning a shared bed");
  setCouple(plan, first, second);
  setBedPartner(state, first, second);
  plan.accommodation.guests = Object.fromEntries(
    state.guests.map((guest) => [
      guest.id,
      accommodationPreferencesSchema.parse(guest),
    ]),
  );
}

export function setTablePairDecision(
  plan: WeddingPlan,
  first: string,
  second: string,
  decision: PairDecision,
): void {
  requireGuest(plan, first);
  requireGuest(plan, second);
  if (first === second) throw new Error("Choose two different guests");
  plan.seating.dismissed_accommodation_suggestions =
    plan.seating.dismissed_accommodation_suggestions.filter(
      (pair) => !(pair.includes(first) && pair.includes(second)),
    );
  if (decision === "unset")
    plan.seating.dismissed_accommodation_suggestions.push([first, second]);
  for (const [id, other] of [
    [first, second],
    [second, first],
  ] as const) {
    const preferences = seatingPreferencesSchema.parse(
      plan.seating.preferences[id] ?? {},
    );
    preferences.prefer_table_with = preferences.prefer_table_with.filter(
      (guestId) => guestId !== other,
    );
    preferences.avoid_table_with = preferences.avoid_table_with.filter(
      (guestId) => guestId !== other,
    );
    if (decision === "yes") preferences.prefer_table_with.push(other);
    if (decision === "no") preferences.avoid_table_with.push(other);
    plan.seating.preferences[id] = preferences;
  }
}
