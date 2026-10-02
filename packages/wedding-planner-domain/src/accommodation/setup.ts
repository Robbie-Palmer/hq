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
