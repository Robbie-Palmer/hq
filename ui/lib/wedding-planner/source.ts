import type { Allocation, PartyName, State } from "./types";

export type SolvePayload = {
  report: string;
  warnings: string[];
  result: Allocation;
  parties: PartyName[];
};

export type PlannerSource = {
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  solve(state: State): Promise<SolvePayload>;
};
