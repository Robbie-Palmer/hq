"use client";

import { HousingStrategyPlanner } from "./housing-strategy-planner";
import { MortgageCalculator } from "./mortgage-calculator";
import { MortgageInvestmentComparison } from "./mortgage-investment-comparison";

export function MortgageRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">
          Mortgage planning
        </h1>
        <p className="text-lg text-muted-foreground">
          Compare mortgage terms, overpayments, investing, and housing choices.
        </p>
      </div>
      <MortgageCalculator />
      <MortgageInvestmentComparison />
      <HousingStrategyPlanner />
    </div>
  );
}
