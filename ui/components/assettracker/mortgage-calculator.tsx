"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency, todayIsoDate } from "@/lib/assettracker";
import {
  type AccountDetailView,
  calculateMortgageOptions,
  type MortgageCalculatorAssumptions,
  type MortgageScenarioSource,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { MortgageCalculatorControls } from "./mortgage-calculator-controls";
import { buildMortgageCalculatorModel } from "./mortgage-calculator-model";
import {
  MortgageCalculatorHighlights,
  MortgageDepositComparison,
  MortgageRateStress,
  MortgageScheduleDetails,
} from "./mortgage-calculator-results";

function describeSource(
  source: MortgageScenarioSource,
  accountDetails: AccountDetailView[],
): string {
  const accountNames = new Map(
    accountDetails.map((account) => [account.id, account.name]),
  );
  const names = [source.mortgageAccountId, source.propertyAccountId]
    .filter((id): id is string => id != null)
    .map((id) => accountNames.get(id) ?? id);
  if (names.length === 0) return "Hypothetical mortgage";
  const snapshot =
    source.snapshotDate == null ? "" : ` at ${source.snapshotDate}`;
  return `${names.join(" and ")}${snapshot}`;
}

export function MortgageCalculator() {
  const {
    accountDetails = [],
    baseCurrency,
    housingPlanningPosition,
    mortgageScenarios = [],
    saveMortgageScenario,
  } = useAssetTracker();
  const mortgage = accountDetails.find(
    (account) =>
      account.assetType === "mortgage" &&
      account.isOpen &&
      account.latestBalance != null &&
      account.mortgageTerms != null,
  );
  const property = accountDetails.find(
    (account) => account.id === mortgage?.linkedAccountId,
  );
  const defaults = useMemo(
    () =>
      buildMortgageCalculatorModel({
        asOfDate: housingPlanningPosition?.asOfDate ?? todayIsoDate(),
        mortgage,
        property,
        position: housingPlanningPosition,
      }),
    [housingPlanningPosition, mortgage, property],
  );
  const [editedAssumptions, setEditedAssumptions] =
    useState<MortgageCalculatorAssumptions | null>(null);
  const [editedSource, setEditedSource] =
    useState<MortgageScenarioSource | null>(null);
  const [scenarioName, setScenarioName] = useState("Mortgage plan");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const assumptions = editedAssumptions ?? defaults.assumptions;
  const source = editedSource ?? defaults.source;
  const sourceLabel =
    editedSource == null
      ? defaults.sourceLabel
      : describeSource(editedSource, accountDetails);
  const result = useMemo(
    () => calculateMortgageOptions(assumptions),
    [assumptions],
  );
  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);

  async function save(recordDecision: boolean) {
    setSaveState("saving");
    try {
      await saveMortgageScenario({
        name: scenarioName,
        assumptions,
        source,
        recordDecision,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Mortgage calculator</CardTitle>
        <CardDescription>
          Compare deposits, repayment terms, rate changes, and overpayments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <div className="rounded-md border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Starting facts</p>
          <p className="mt-1 font-medium">{sourceLabel}</p>
        </div>
        <MortgageCalculatorHighlights result={result} money={money} />
        {result.selected.fundingShortfall > 0 && (
          <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            This option needs {money(result.selected.fundingShortfall)} more
            upfront funding.
          </p>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">Deposit comparison</h3>
          <MortgageDepositComparison result={result} money={money} />
        </div>
        <MortgageCalculatorControls
          assumptions={assumptions}
          onChange={(next) => {
            setEditedAssumptions(next);
            setSaveState("idle");
          }}
        />
        <MortgageRateStress result={result} money={money} />
        <MortgageScheduleDetails result={result} money={money} />

        <div className="space-y-3 rounded-md border p-4">
          <div>
            <h3 className="text-sm font-medium">Save this scenario</h3>
            <p className="text-xs text-muted-foreground">
              The saved copy keeps the source account and snapshot date. A
              recorded decision also appears on the Decisions page.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Scenario name"
              value={scenarioName}
              onChange={(event) => {
                setScenarioName(event.target.value);
                setSaveState("idle");
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={saveState === "saving" || scenarioName.trim() === ""}
              onClick={() => void save(false)}
            >
              Save scenario
            </Button>
            <Button
              type="button"
              disabled={saveState === "saving" || scenarioName.trim() === ""}
              onClick={() => void save(true)}
            >
              Record decision
            </Button>
          </div>
          {saveState === "saved" && (
            <p className="text-xs text-muted-foreground">
              Saved in this browser.
            </p>
          )}
          {saveState === "error" && (
            <p className="text-xs text-destructive">
              The scenario could not be saved.
            </p>
          )}
          {mortgageScenarios.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Saved scenarios
              </p>
              <div className="flex flex-wrap gap-2">
                {mortgageScenarios.map((scenario) => (
                  <Button
                    key={scenario.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditedAssumptions(scenario.assumptions);
                      setEditedSource(scenario.source);
                      setScenarioName(scenario.name);
                      setSaveState("idle");
                    }}
                  >
                    {scenario.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
