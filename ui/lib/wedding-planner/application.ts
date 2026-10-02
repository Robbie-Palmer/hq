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
import type { State } from "./types";

/** UI projection of application use cases, independent of the persistence adapter. */
export interface PlannerApplication {
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  calculateRooms(state: State): Promise<SolvePayload>;
  calculateTables(state: State): Promise<TableAllocation>;
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
