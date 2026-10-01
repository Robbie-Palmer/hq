import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import type { PlannerSource } from "./source";
import { parseState } from "./state";

const STORAGE_KEY = "wedding-planner:plan:v1";
const LEGACY_STORAGE_KEY = "wedding-rooms:plan:v1";

export function createBrowserPlannerSource(
  setup: AccommodationSetup,
  storageKey: string,
  legacyStorageKey?: string,
): PlannerSource {
  return {
    async load() {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) return parseState(JSON.parse(saved), setup);

      const legacy = legacyStorageKey
        ? window.localStorage.getItem(legacyStorageKey)
        : null;
      if (!legacy) return null;
      const state = parseState(JSON.parse(legacy), setup);
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      return state;
    },
    async save(state) {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(parseState(state, setup)),
      );
    },
    async solve(state) {
      const { calculateRooms } = await import("./calculate");
      return calculateRooms(state, setup);
    },
  };
}

export const browserPlannerSource = createBrowserPlannerSource(
  weddingAccommodationSetup,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
);
