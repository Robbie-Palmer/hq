import {
  createWeddingPlannerApplication,
  type WeddingPlannerApplication,
  type WeddingPlanRepository,
} from "wedding-planner-domain";
import type { SolvePayload } from "wedding-planner-domain/accommodation";
import type { TableAllocation } from "wedding-planner-domain/seating";
import { browserWeddingPlanRepository } from "./browser-repository";
import { editorStateToPlan, toEditorState } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import type { WeddingPlanDraft } from "./types";

export interface PlannerApplication {
  load(): Promise<WeddingPlanDraft | null>;
  save(plan: WeddingPlanDraft): Promise<void>;
  calculateRooms(plan: WeddingPlanDraft): Promise<SolvePayload>;
  calculateTables(plan: WeddingPlanDraft): Promise<TableAllocation>;
}

export function createEditorApplication(
  application: WeddingPlannerApplication,
): PlannerApplication {
  return {
    async load() {
      const plan = await application.load();
      return plan ? toEditorState(plan) : null;
    },
    save: (state) => application.save(editorStateToPlan(state)),
    calculateRooms: (state) =>
      application.calculateRooms(editorStateToPlan(state)),
    calculateTables: (state) =>
      application.calculateTables(editorStateToPlan(state)),
  };
}

export function createPlannerApplication(
  repository: WeddingPlanRepository,
  setup: AccommodationSetup = weddingAccommodationSetup,
): PlannerApplication {
  return createEditorApplication(
    createWeddingPlannerApplication(
      repository,
      setup,
      {
        async solve(input) {
          const { solveRooms } = await import("./solve-rooms");
          return solveRooms(input);
        },
      },
      {
        async solve(input) {
          const { solveTables } = await import("./solve-tables");
          return solveTables(input);
        },
      },
    ),
  );
}

export const browserPlannerApplication = createPlannerApplication(
  browserWeddingPlanRepository,
);
