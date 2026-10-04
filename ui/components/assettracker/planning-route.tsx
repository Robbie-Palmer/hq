"use client";

import { HousingStrategyPlanner } from "./housing-strategy-planner";
import { MortgageCalculator } from "./mortgage-calculator";
import { MortgageInvestmentComparison } from "./mortgage-investment-comparison";
import { PortfolioGoal } from "./portfolio-goal";

export function PlanningRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Planning</h1>
        <p className="text-lg text-muted-foreground">
          Model financial independence, runway, planned spending, and portfolio
          growth.
        </p>
      </div>
      <PortfolioGoal showIncomeTools={false} />
      <MortgageCalculator />
      <MortgageInvestmentComparison />
      <HousingStrategyPlanner />
    </div>
  );
}
