import { parseMoneyToMinorUnits } from "../money";
import type { AccommodationSetup } from "./setup";
import type { State } from "./types";

export function validateAccommodationState(
  state: State,
  setup: AccommodationSetup,
): void {
  if (setup.fixedNights && state.nights !== setup.fixedNights)
    throw new Error(`This plan must cover ${setup.fixedNights} night(s)`);
  const rooms = new Set(setup.input.rooms.map((room) => room.id));
  for (const roomId of Object.keys(state.reservations)) {
    if (!rooms.has(roomId))
      throw new Error(`${roomId} reservation refers to an unknown room`);
  }
  if (setup.reservation && !setup.reservation.guestIds(state).length)
    throw new Error(`Choose the existing ${setup.reservation.label} guests`);
  parseMoneyToMinorUnits(state.max_cottage_spend_gbp, "Maximum cottage spend");
  parseMoneyToMinorUnits(
    state.default_outside_cost_gbp,
    "Default outside cost",
  );
  parseMoneyToMinorUnits(state.guest_charge_cap_gbp, "Guest charge cap");
  for (const guest of state.guests)
    parseMoneyToMinorUnits(
      guest.outside_cost_gbp,
      `${guest.name} outside cost`,
    );
}
