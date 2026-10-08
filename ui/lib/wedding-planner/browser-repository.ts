import { promiseFromSync } from "ts-base/promises";
import {
  parseWeddingPlan,
  type WeddingPlanRepository,
} from "wedding-planner-domain";
import { decodeWeddingPlan } from "./plan-codec";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";

const STORAGE_KEY = "wedding-planner:plan:v2";
const LEGACY_KEYS = ["wedding-planner:plan:v1", "wedding-rooms:plan:v1"];

export function createBrowserWeddingPlanRepository(
  storage: Pick<Storage, "getItem" | "setItem">,
  key = STORAGE_KEY,
  legacyKeys = LEGACY_KEYS,
  setup: AccommodationSetup = weddingAccommodationSetup,
): WeddingPlanRepository {
  return {
    load: () =>
      promiseFromSync(() => {
        const saved = storage.getItem(key);
        if (saved !== null) return decodeWeddingPlan(JSON.parse(saved), setup);
        for (const legacyKey of legacyKeys) {
          const legacy = storage.getItem(legacyKey);
          if (legacy === null) continue;
          const plan = decodeWeddingPlan(JSON.parse(legacy), setup);
          storage.setItem(key, JSON.stringify(plan));
          return plan;
        }
        return null;
      }),
    save: (plan) =>
      promiseFromSync(() => {
        storage.setItem(key, JSON.stringify(parseWeddingPlan(plan)));
      }),
  };
}

export const browserWeddingPlanRepository: WeddingPlanRepository = {
  load: () => createBrowserWeddingPlanRepository(window.localStorage).load(),
  save: (plan) =>
    createBrowserWeddingPlanRepository(window.localStorage).save(plan),
};
