import {
  evaluateSoleTraderScenario,
  SoleTraderScenarioInputSchema,
  type SoleTraderScenarioResult,
} from "personal-finance-contracts/sole-trader-scenario";
import { z } from "zod";

export const HouseholdSoleTraderScenarioSchema = z
  .object({
    id: z.string().trim().min(1),
    memberId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    scenario: SoleTraderScenarioInputSchema,
  })
  .strict();

export type HouseholdSoleTraderScenario = z.infer<
  typeof HouseholdSoleTraderScenarioSchema
>;

export type HouseholdSoleTraderScenarioView = HouseholdSoleTraderScenario & {
  result: SoleTraderScenarioResult;
};

export function evaluateHouseholdSoleTraderScenario(
  scenario: HouseholdSoleTraderScenario,
): HouseholdSoleTraderScenarioView {
  return {
    ...scenario,
    result: evaluateSoleTraderScenario(scenario.scenario),
  };
}
