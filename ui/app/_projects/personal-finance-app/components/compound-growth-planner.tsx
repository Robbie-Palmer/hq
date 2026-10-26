"use client";

import { latestOnsInflationRelease } from "finance-inflation-indices/dataset";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAssetTracker } from "./asset-tracker-provider";
import { CompoundGrowthAssumptions } from "./compound-growth-assumptions";
import {
  buildGrowthScenario,
  calculateGrowthProjections,
  downloadGrowthCalculation,
  useStoredGrowthDraft,
} from "./compound-growth-planner-model";
import { CompoundGrowthResults } from "./compound-growth-results";

export function CompoundGrowthPlanner() {
  const { accountDetails = [], baseCurrency = "GBP" } = useAssetTracker();
  const [draft, setDraft] = useStoredGrowthDraft();
  const availableAccounts = accountDetails.filter(
    (account) =>
      account.isOpen &&
      account.latestBalance != null &&
      account.latestBalance > 0 &&
      account.currency === baseCurrency,
  );
  const scenario = buildGrowthScenario(draft, availableAccounts);
  const { error, projections } = calculateGrowthProjections(scenario);
  const inflationRelease = latestOnsInflationRelease("CPIH");

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>
            <h2>Contribution and compound growth planner</h2>
          </CardTitle>
          <CardDescription>
            Saved in this browser. Returns and future inflation are
            hypothetical.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            downloadGrowthCalculation({
              draftId: draft.id,
              inflationRelease,
              projections,
              scenario,
            })
          }
        >
          <Download /> Export calculation
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <CompoundGrowthAssumptions
          accounts={availableAccounts}
          currency={baseCurrency}
          draft={draft}
          setDraft={setDraft}
        />
        <CompoundGrowthResults
          currency={baseCurrency}
          inflationRelease={inflationRelease}
          projectionError={error}
          projections={projections}
          returnType={draft.returnType}
        />
      </CardContent>
    </Card>
  );
}
