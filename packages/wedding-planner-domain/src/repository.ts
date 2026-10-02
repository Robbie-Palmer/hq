import type { WeddingPlan } from "./plan";

/** Persistence of one wedding aggregate. Allocation belongs to application services. */
export interface WeddingPlanRepository {
  load(): Promise<WeddingPlan | null>;
  save(plan: WeddingPlan): Promise<void>;
}
