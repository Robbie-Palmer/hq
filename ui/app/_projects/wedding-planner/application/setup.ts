import template from "./template.json";
import type { PlannerInput } from "./types";

export type {
  AccommodationSetup,
  ReservationRule,
} from "wedding-planner-domain/accommodation";
export { validateAccommodationSetup } from "wedding-planner-domain/accommodation";

import type { AccommodationSetup } from "wedding-planner-domain/accommodation";
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
