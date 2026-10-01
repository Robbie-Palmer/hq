import template from "./template.json";
import type { PlannerInput, State } from "./types";

export type ReservationRule = {
  roomId: string;
  label: string;
  legacyFields?: { guestIds: string; approvedGuestIds: string };
  guestIds: (state: State) => string[];
  approvedGuestIds: (state: State) => string[];
  setApprovedGuestIds: (state: State, ids: string[]) => void;
};

export type AccommodationSetup = {
  input: PlannerInput;
  fixedNights?: number;
  reservation?: ReservationRule;
};

export function validateAccommodationSetup(setup: AccommodationSetup): void {
  const properties = new Set(
    setup.input.properties.map((property) => property.id),
  );
  const rooms = new Set(setup.input.rooms.map((room) => room.id));
  if (properties.size !== setup.input.properties.length)
    throw new Error("Accommodation setup has duplicate property IDs");
  if (rooms.size !== setup.input.rooms.length)
    throw new Error("Accommodation setup has duplicate room IDs");
  for (const room of setup.input.rooms) {
    if (!properties.has(room.property_id))
      throw new Error(`${room.id} refers to an unknown property`);
  }
  for (const party of setup.input.parties) {
    if (party.fixed_room_id && !rooms.has(party.fixed_room_id))
      throw new Error(`${party.id} refers to an unknown fixed room`);
  }
  if (setup.reservation && !rooms.has(setup.reservation.roomId))
    throw new Error(`${setup.reservation.label} room is missing from setup`);
}

// The allocator receives an inventory. Only this app adapter knows which
// imported fields represent the already booked Linen room.
export const weddingAccommodationSetup: AccommodationSetup = {
  input: template as PlannerInput,
  fixedNights: 1,
  reservation: {
    roomId: "linen_1",
    label: "Linen Cottage",
    legacyFields: {
      guestIds: "linen_guest_ids",
      approvedGuestIds: "linen_approved_guest_ids",
    },
    guestIds: (state) => state.reservations.linen_1?.guest_ids ?? [],
    approvedGuestIds: (state) =>
      state.reservations.linen_1?.approved_guest_ids ?? [],
    setApprovedGuestIds: (state, ids) => {
      const reservation = state.reservations.linen_1;
      if (reservation) reservation.approved_guest_ids = ids;
    },
  },
};
