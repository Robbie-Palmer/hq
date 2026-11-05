import {
  employmentPlusTradingSoleTraderScenario,
  lowRevenueSoleTraderScenario,
  vatThresholdSoleTraderScenario,
} from "personal-finance-contracts/sole-trader-synthetic-scenarios";
import type { HouseholdSoleTraderScenario } from "@/app/_projects/personal-finance-app/domain/soleTraderScenario";

export const soleTraderScenarios: HouseholdSoleTraderScenario[] = [
  {
    id: "alex-freelance-design",
    memberId: "alex",
    name: "Freelance design",
    description:
      "Alex combines employment with a growing design trade, including bookkeeping, accountancy, a Plan 2 loan and invoices still to collect.",
    scenario: employmentPlusTradingSoleTraderScenario,
  },
  {
    id: "sam-occasional-projects",
    memberId: "sam",
    name: "Occasional projects",
    description:
      "Sam tests a small first year below the trading allowance, with one unpaid invoice and no tax reserve needed yet.",
    scenario: lowRevenueSoleTraderScenario,
  },
  {
    id: "alex-vat-threshold-growth",
    memberId: "alex",
    name: "VAT-threshold growth",
    description:
      "Alex stress-tests annual sales above the VAT registration threshold, Class 4 National Insurance and the resulting cash deadline.",
    scenario: vatThresholdSoleTraderScenario,
  },
];
