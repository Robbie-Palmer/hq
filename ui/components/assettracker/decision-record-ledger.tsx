"use client";

import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  FinancialDecisionRecord,
  MortgageScenario,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { CreateDecisionRecordForm } from "./decision-record-forms";
import { TrackedDecisionCard } from "./tracked-decision-card";

function sourceDescription(sourceAccounts: string, snapshotDate?: string) {
  if (sourceAccounts === "") return "Based on explicitly entered assumptions.";
  const dateDescription = snapshotDate == null ? "" : ` at ${snapshotDate}`;
  return `Based on ${sourceAccounts}${dateDescription}.`;
}

function LegacyDecisionRecordCard({
  decision,
  scenario,
  accountNames,
  baseCurrency,
}: Readonly<{
  decision: Extract<FinancialDecisionRecord, { kind: "mortgage" }>;
  scenario: MortgageScenario;
  accountNames: Map<string, string>;
  baseCurrency: Currency;
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

function EmptyDecisionRecords() {
  return (
    <div className="rounded-lg border border-dashed px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">No decision records yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Save a choice, its source inputs, and a checkpoint to compare later.
      </p>
    </div>
  );
}

export function DecisionRecordLedger() {
  const { accountDetails, baseCurrency, decisionRecords, mortgageScenarios } =
    useAssetTracker();
  const scenarios = new Map(
    mortgageScenarios.map((scenario) => [scenario.id, scenario]),
  );
  const accountNames = new Map(
    accountDetails.map((account) => [account.id, account.name]),
  );
  return (
    <div className="space-y-4">
      <CreateDecisionRecordForm />
      {decisionRecords.length === 0 ? (
        <EmptyDecisionRecords />
      ) : (
        decisionRecords.map((decision) => {
          if (decision.kind === "tracked") {
            return (
              <TrackedDecisionCard
                key={decision.id}
                baseCurrency={baseCurrency}
                decision={decision}
              />
            );
          }
          const scenario = scenarios.get(decision.scenarioId);
          if (scenario == null) return null;
          return (
            <LegacyDecisionRecordCard
              key={decision.id}
              accountNames={accountNames}
              baseCurrency={baseCurrency}
              decision={decision}
              scenario={scenario}
            />
          );
        })
      )}
    </div>
  );
}
