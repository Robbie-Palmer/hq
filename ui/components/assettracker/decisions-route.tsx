"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { DecisionScenarioComparison } from "./decision-scenario-comparison";
import { ForecastAssumptionManager } from "./forecast-assumption-manager";
import { FutureCashFlowManager } from "./future-cash-flow-manager";
import { JobMoveScenarioManager } from "./job-move-scenario-manager";

function sourceDescription(sourceAccounts: string, snapshotDate?: string) {
  if (sourceAccounts === "") return "Based on explicitly entered assumptions.";
  const dateDescription = snapshotDate == null ? "" : ` at ${snapshotDate}`;
  return `Based on ${sourceAccounts}${dateDescription}.`;
}

function DecisionRecordCard({
  decision,
  scenario,
  accountNames,
  baseCurrency,
}: Readonly<{
  decision: ReturnType<typeof useAssetTracker>["decisionRecords"][number];
  scenario: ReturnType<typeof useAssetTracker>["mortgageScenarios"][number];
  accountNames: Map<string, string>;
  baseCurrency: ReturnType<typeof useAssetTracker>["baseCurrency"];
}>) {
  const sourceAccounts = [
    scenario.source.mortgageAccountId,
    scenario.source.propertyAccountId,
  ]
    .filter((id): id is string => id != null)
    .map((id) => accountNames.get(id) ?? id)
    .join(" and ");
  const { assumptions } = scenario;
  const facts = [
    ["Property", formatCurrency(assumptions.purchasePrice, baseCurrency)],
    ["Deposit", formatCurrency(assumptions.depositAmount, baseCurrency)],
    ["Initial rate", `${(assumptions.initialAnnualRate * 100).toFixed(2)}%`],
    ["Term", `${assumptions.termMonths} months`],
  ];
  return (
    <article className="rounded-lg border p-5">
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
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        {sourceDescription(sourceAccounts, scenario.source.snapshotDate)}
      </p>
    </article>
  );
}

function RecordedDecisions() {
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
          Record a mortgage scenario from the Mortgage page to keep its inputs
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
        return (
          <DecisionRecordCard
            key={decision.id}
            decision={decision}
            scenario={scenario}
            accountNames={accountNames}
            baseCurrency={baseCurrency}
          />
        );
      })}
    </div>
  );
}

export function DecisionsRoute() {
  return (
    <Tabs defaultValue="compare" className="space-y-5">
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="compare">Compare</TabsTrigger>
        <TabsTrigger value="jobs">Job moves</TabsTrigger>
        <TabsTrigger value="inputs">Forecast inputs</TabsTrigger>
        <TabsTrigger value="recorded">Recorded</TabsTrigger>
      </TabsList>
      <TabsContent value="compare" className="mt-0">
        <DecisionScenarioComparison />
      </TabsContent>
      <TabsContent value="jobs" className="mt-0">
        <JobMoveScenarioManager />
      </TabsContent>
      <TabsContent value="inputs" className="mt-0 space-y-6">
        <ForecastAssumptionManager />
        <FutureCashFlowManager />
      </TabsContent>
      <TabsContent value="recorded" className="mt-0">
        <RecordedDecisions />
      </TabsContent>
    </Tabs>
  );
}
