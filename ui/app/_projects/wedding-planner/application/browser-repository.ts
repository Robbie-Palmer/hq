import { promiseFromSync } from "ts-base/promises";
import type { WeddingPlanRepository } from "wedding-planner-domain";
import { decodeWeddingPlan, encodeWeddingPlan } from "./plan-codec";

const STORAGE_KEY = "wedding-planner:plan:v2";

export function createBrowserWeddingPlanRepository(
  storage: Pick<Storage, "getItem" | "setItem">,
  key = STORAGE_KEY,
): WeddingPlanRepository {
  return {
    load: () =>
      promiseFromSync(() => {
        const saved = storage.getItem(key);
        return saved === null ? null : decodeWeddingPlan(saved);
      }),
    save: (plan) =>
      promiseFromSync(() => {
        storage.setItem(key, encodeWeddingPlan(plan));
      }),
  };
}

export const browserWeddingPlanRepository: WeddingPlanRepository = {
  load: () => createBrowserWeddingPlanRepository(window.localStorage).load(),
  save: (plan) =>
    createBrowserWeddingPlanRepository(window.localStorage).save(plan),
};
