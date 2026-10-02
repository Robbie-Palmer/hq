import { calculateRooms } from "./accommodation/calculate";
import type { RoomAllocator } from "./accommodation/ports";
import type { AccommodationSetup } from "./accommodation/setup";
import { parseWeddingPlan, type WeddingPlan } from "./plan";
import { accommodationState, tableInput } from "./projections";
import type { WeddingPlanRepository } from "./repository";
import { prepareTableProblem } from "./seating/problem";
import type { TableAllocator } from "./seating/types";

export function createWeddingPlannerApplication(
  repository: WeddingPlanRepository,
  setup: AccommodationSetup,
  rooms: RoomAllocator,
  tables: TableAllocator,
) {
  return {
    async load() {
      const plan = await repository.load();
      return plan ? parseWeddingPlan(plan) : null;
    },
    async save(plan: WeddingPlan) {
      await repository.save(parseWeddingPlan(plan));
    },
    async calculateRooms(plan: WeddingPlan) {
      return calculateRooms(
        accommodationState(parseWeddingPlan(plan)),
        setup,
        rooms,
      );
    },
    async calculateTables(plan: WeddingPlan) {
      const input = tableInput(parseWeddingPlan(plan));
      prepareTableProblem(input);
      return tables.solve(input);
    },
  };
}
export type WeddingPlannerApplication = ReturnType<
  typeof createWeddingPlannerApplication
>;
