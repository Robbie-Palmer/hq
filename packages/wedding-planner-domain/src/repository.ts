import type { WeddingPlan } from "./plan";

export interface WeddingPlanRepository {
  load(): Promise<WeddingPlan | null>;
  save(plan: WeddingPlan): Promise<void>;
}
