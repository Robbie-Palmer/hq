import type { Allocation, PartyName, Placement, PlannerInput } from "./types";

export interface RoomAllocator {
  solve(input: PlannerInput): Promise<Placement>;
}
export type SolvePayload = {
  report: string;
  warnings: string[];
  result: Allocation;
  parties: PartyName[];
};
