import {
  accommodationState,
  confirmCoupleSharingBed,
  markNotCouple as markRelationship,
} from "wedding-planner-domain";
import {
  type State as AccommodationState,
  accommodationPreferencesSchema,
  pairDecision as decision,
  setOwnBed as ownBed,
  setPairDecision as pairChoice,
  setBedPartner,
  setShareMode as shareMode,
} from "wedding-planner-domain/accommodation";
import type { ShareMode } from "wedding-planner-domain/values";
import { editDomain } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import type { BedGroup, PairDecision, SharingLevel, State } from "./types";

function editAccommodation(
  state: State,
  change: (snapshot: AccommodationState) => void,
): void {
  editDomain(state, (plan) => {
    const snapshot = accommodationState(plan);
    change(snapshot);
    plan.accommodation = {
      ...snapshot,
      nights: snapshot.nights ?? 1,
      guests: Object.fromEntries(
        snapshot.guests.map((guest) => [
          guest.id,
          accommodationPreferencesSchema.parse(guest),
        ]),
      ),
    };
  });
}

export function setShareMode(
  state: State,
  id: string,
  level: "room" | "cottage",
  mode: ShareMode,
  setup: AccommodationSetup = weddingAccommodationSetup,
): void {
  editAccommodation(state, (snapshot) =>
    shareMode(snapshot, id, level, mode, setup),
  );
}
export function setPairDecision(
  state: State,
  level: SharingLevel,
  sourceId: string,
  targetId: string,
  choice: PairDecision,
  setup: AccommodationSetup = weddingAccommodationSetup,
): void {
  editAccommodation(state, (snapshot) =>
    pairChoice(snapshot, level, sourceId, targetId, choice, setup),
  );
}
export function setOwnBed(state: State, id: string, required: boolean): void {
  editAccommodation(state, (snapshot) => ownBed(snapshot, id, required));
}
/** This editor action explicitly confirms a couple and a shared bed. */
export function setPartner(state: State, id: string, partnerId: string): void {
  if (partnerId) {
    const first = state.guests.find((guest) => guest.id === id);
    const second = state.guests.find((guest) => guest.id === partnerId);
    if (
      !first ||
      !second ||
      first.requires_own_bed ||
      second.requires_own_bed ||
      second.fixed_bed_group_id
    )
      return;
    editDomain(state, (plan) => confirmCoupleSharingBed(plan, id, partnerId));
  } else {
    // Removing a bed assignment does not change the couple relationship.
    editAccommodation(state, (snapshot) => setBedPartner(snapshot, id, ""));
  }
}
export function markNotCouple(
  state: State,
  first: string,
  second: string,
  notCouple: boolean,
): void {
  editDomain(state, (plan) => markRelationship(plan, first, second, notCouple));
}
export function pairDecision(
  state: State | null,
  focus: BedGroup | undefined,
  target: BedGroup,
  level: SharingLevel,
  setup: AccommodationSetup = weddingAccommodationSetup,
): PairDecision {
  return decision(
    state as AccommodationState | null,
    focus,
    target,
    level,
    setup,
  );
}
