"use client";

import { formatCurrency } from "@/lib/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

export function DecisionsRoute() {
  const { accountDetails, baseCurrency, decisionRecords, mortgageScenarios } =
    useAssetTracker();
  const scenarios = new Map(
    mortgageScenarios.map((scenario) => [scenario.id, scenario]),
  );
  const accountNames = new Map(
    accountDetails.map((account) => [account.id, account.name]),
  );

  if (decisionRecords.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">No decision records yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Record a mortgage scenario from the Planning page to keep its inputs
          and source facts here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {decisionRecords.map((decision) => {
        const scenario = scenarios.get(decision.scenarioId);
        if (scenario == null) return null;
        const sourceAccounts = [
          scenario.source.mortgageAccountId,
          scenario.source.propertyAccountId,
        ]
          .filter((id): id is string => id != null)
          .map((id) => accountNames.get(id) ?? id)
          .join(" and ");
        const { assumptions } = scenario;
        return (
          <article key={decision.id} className="rounded-lg border p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{decision.title}</h2>
                <p className="text-xs text-muted-foreground">
                  Recorded {decision.recordedAt}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">
                Mortgage
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Property</dt>
                <dd>
                  {formatCurrency(assumptions.purchasePrice, baseCurrency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Deposit</dt>
                <dd>
                  {formatCurrency(assumptions.depositAmount, baseCurrency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Initial rate</dt>
                <dd>{(assumptions.initialAnnualRate * 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Term</dt>
                <dd>{assumptions.termMonths} months</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              {sourceAccounts === ""
                ? "Based on explicitly entered assumptions."
                : `Based on ${sourceAccounts}${scenario.source.snapshotDate == null ? "." : ` at ${scenario.source.snapshotDate}.`}`}
            </p>
          </article>
        );
      })}
    </div>
  );
}
