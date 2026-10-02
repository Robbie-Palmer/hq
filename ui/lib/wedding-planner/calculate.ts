import { accommodationState } from "wedding-planner-domain";
import { calculateRooms as calculate } from "wedding-planner-domain/accommodation";
import { editorStateToPlan } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import { solveRooms } from "./solve-rooms";
import { parseState } from "./state";
import type { State } from "./types";

export function calculateRooms(
  state: State,
  setup: AccommodationSetup = weddingAccommodationSetup,
) {
  return calculate(
    accommodationState(editorStateToPlan(parseState(state, setup))),
    setup,
    { solve: solveRooms },
  );
}
