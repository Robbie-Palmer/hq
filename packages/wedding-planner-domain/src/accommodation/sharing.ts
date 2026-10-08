import type { AccommodationSetup } from "./setup";
import type {
  BedGroup,
  Guest,
  PairDecision,
  SharingLevel,
  State,
} from "./types";
import type { ShareMode } from "../values";

type PairField =
  | "may_share_bed_with"
  | "may_share_room_with"
  | "may_share_cottage_with"
  | "avoid_bed_with"
  | "avoid_room_with"
  | "avoid_cottage_with";

const groupId = (guest: Guest) => guest.fixed_bed_group_id || guest.id;
const groupMembers = (state: State, id: string) =>
  state.guests.filter((guest) => groupId(guest) === id);

function fields(level: SharingLevel): { yes: PairField; no: PairField } {
  if (level === "bed")
    return { yes: "may_share_bed_with", no: "avoid_bed_with" };
  if (level === "room")
    return { yes: "may_share_room_with", no: "avoid_room_with" };
  return { yes: "may_share_cottage_with", no: "avoid_cottage_with" };
}

export function setShareMode(
  state: State,
  id: string,
  level: "room" | "cottage",
  mode: ShareMode,
  setup: AccommodationSetup,
): void {
  const source = state.guests.find((guest) => guest.id === id);
  if (!source) return;
  const members = groupMembers(state, groupId(source));
  for (const member of members) {
    if (level === "room") {
      member.room_share_mode = mode;
      member.can_share_room = mode !== "none";
    } else {
      member.cottage_share_mode = mode;
      member.can_share_cottage = mode !== "none";
    }
  }
  if (mode !== "none") return;
  const ids = new Set(members.map((guest) => guest.id));
  const field = fields(level).yes;
  for (const guest of state.guests) {
    guest[field] = ids.has(guest.id)
      ? []
      : guest[field].filter((other) => !ids.has(other));
  }
  const reservation = setup.reservation;
  if (level === "cottage" && reservation) {
    const includesOwners = members.some((guest) =>
      reservation.guestIds(state).includes(guest.id),
    );
    reservation.setApprovedGuestIds(
      state,
      includesOwners
        ? []
        : reservation
            .approvedGuestIds(state)
            .filter((guestId) => !ids.has(guestId)),
    );
  }
}

function updateMemberLinks(
  members: Guest[],
  others: Guest[],
  level: SharingLevel,
  decision: PairDecision,
): void {
  const { yes, no } = fields(level);
  const ids = new Set(others.map((guest) => guest.id));
  for (const member of members) {
    member[yes] =
      decision === "yes"
        ? [...new Set([...member[yes], ...ids])]
        : member[yes].filter((id) => !ids.has(id));
    member[no] =
      decision === "no"
        ? [...new Set([...member[no], ...ids])]
        : member[no].filter((id) => !ids.has(id));
    if (decision !== "yes") continue;
    if (level === "room" && member.room_share_mode === "none") {
      member.room_share_mode = "selected";
      member.can_share_room = true;
    }
    if (level === "cottage" && member.cottage_share_mode === "none") {
      member.cottage_share_mode = "selected";
      member.can_share_cottage = true;
    }
  }
}

function updateReservationApproval(
  state: State,
  first: Guest[],
  second: Guest[],
  decision: PairDecision,
  setup: AccommodationSetup,
): void {
  const reservation = setup.reservation;
  if (!reservation) return;
  const firstIsReserved = first.some((guest) =>
    reservation.guestIds(state).includes(guest.id),
  );
  const secondIsReserved = second.some((guest) =>
    reservation.guestIds(state).includes(guest.id),
  );
  if (!firstIsReserved && !secondIsReserved) return;
  const approved = new Set(
    (firstIsReserved ? second : first).map((guest) => guest.id),
  );
  reservation.setApprovedGuestIds(
    state,
    decision === "yes"
      ? [...new Set([...reservation.approvedGuestIds(state), ...approved])]
      : reservation.approvedGuestIds(state).filter((id) => !approved.has(id)),
  );
}

export function setPairDecision(
  state: State,
  level: SharingLevel,
  sourceId: string,
  targetId: string,
  decision: PairDecision,
  setup: AccommodationSetup,
): void {
  const source = state.guests.find((guest) => guest.id === sourceId);
  if (!source) return;
  const firstId = groupId(source);
  if (firstId === targetId) return;
  const first = groupMembers(state, firstId);
  const second = groupMembers(state, targetId);
  if (!second.length) return;
  if (
    level === "bed" &&
    [...first, ...second].some((guest) => guest.requires_own_bed)
  )
    return;
  updateMemberLinks(first, second, level, decision);
  updateMemberLinks(second, first, level, decision);
  if (level === "cottage")
    updateReservationApproval(state, first, second, decision, setup);
}

export function setOwnBed(
  state: State,
  id: string,
  requiresOwnBed: boolean,
): void {
  const guest = state.guests.find((item) => item.id === id);
  if (!guest || guest.overnight === "no") return;
  guest.requires_own_bed = requiresOwnBed;
  if (!requiresOwnBed) return;
  const group = guest.fixed_bed_group_id;
  if (group) {
    for (const member of state.guests.filter(
      (item) => item.fixed_bed_group_id === group,
    ))
      member.fixed_bed_group_id = "";
  }
  guest.may_share_bed_with = [];
  for (const other of state.guests) {
    other.may_share_bed_with = other.may_share_bed_with.filter(
      (otherId) => otherId !== id,
    );
  }
}

function clearPartnerLinks(first: Guest, second: Guest): void {
  first.may_share_bed_with = first.may_share_bed_with.filter(
    (id) => id !== second.id,
  );
  second.may_share_bed_with = second.may_share_bed_with.filter(
    (id) => id !== first.id,
  );
  first.avoid_bed_with = first.avoid_bed_with.filter((id) => id !== second.id);
  second.avoid_bed_with = second.avoid_bed_with.filter((id) => id !== first.id);
}

export function setBedPartner(
  state: State,
  id: string,
  partnerId: string,
): void {
  const guest = state.guests.find((item) => item.id === id);
  if (!guest) return;
  const partner = partnerId
    ? state.guests.find((item) => item.id === partnerId)
    : null;
  if (
    partnerId &&
    (!partner ||
      partner.id === id ||
      partner.fixed_bed_group_id ||
      guest.requires_own_bed ||
      partner.requires_own_bed)
  )
    return;
  const oldGroup = guest.fixed_bed_group_id;
  if (oldGroup)
    for (const member of state.guests.filter(
      (item) => item.fixed_bed_group_id === oldGroup,
    ))
      member.fixed_bed_group_id = "";
  if (!partner) return;
  guest.fixed_bed_group_id = id;
  partner.fixed_bed_group_id = id;
  clearPartnerLinks(guest, partner);
}

function hasLink(members: Guest[], ids: string[], field: PairField): boolean {
  return members.every((guest) => guest[field].some((id) => ids.includes(id)));
}

function hasAvoid(members: Guest[], ids: string[], field: PairField): boolean {
  return members.some((guest) => guest[field].some((id) => ids.includes(id)));
}

export function pairDecision(
  state: State | null,
  focus: BedGroup | undefined,
  target: BedGroup,
  level: SharingLevel,
  setup: AccommodationSetup,
): PairDecision {
  if (!state || !focus) return "unset";
  const first = state.guests.filter((guest) =>
    focus.guestIds.includes(guest.id),
  );
  const second = state.guests.filter((guest) =>
    target.guestIds.includes(guest.id),
  );
  const { yes, no } = fields(level);
  if (
    hasAvoid(first, target.guestIds, no) ||
    hasAvoid(second, focus.guestIds, no)
  )
    return "no";
  if (
    hasLink(first, target.guestIds, yes) &&
    hasLink(second, focus.guestIds, yes)
  )
    return "yes";
  if (level !== "cottage") return "unset";
  const reservation = setup.reservation;
  if (!reservation) return "unset";
  const reserved = [focus, target].find((group) =>
    group.guestIds.some((id) => reservation.guestIds(state).includes(id)),
  );
  if (!reserved) return "unset";
  const other = reserved.id === focus.id ? target : focus;
  return other.guestIds.some((id) =>
    reservation.approvedGuestIds(state).includes(id),
  )
    ? "yes"
    : "unset";
}
