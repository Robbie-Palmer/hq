"use client";

import Link from "next/link";
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
  monthlyAmount,
  type RecurringFlow,
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

function completeMortgage(
  account: AccountDetailView | undefined,
): AccountDetailView | undefined {
  return account?.mortgageTerms == null ? undefined : account;
}

function startingSourceLabel(input: {
  accountDetails: AccountDetailView[];
  defaultLabel: string;
  editedSource: MortgageScenarioSource | null;
  mortgageAccount: AccountDetailView | undefined;
}): string {
  if (input.editedSource != null) {
    return describeSource(input.editedSource, input.accountDetails);
  }
  if (
    input.mortgageAccount != null &&
    input.mortgageAccount.mortgageTerms == null
  ) {
    return `Example assumptions until ${input.mortgageAccount.name} is set up`;
  }
  return input.defaultLabel;
}

function MortgageSetupNotices({
  mortgage,
  mortgageAccount,
  rateAvailable,
}: Readonly<{
  mortgage: AccountDetailView | undefined;
  mortgageAccount: AccountDetailView | undefined;
  rateAvailable: boolean;
}>) {
  return (
    <>
      {mortgageAccount != null && mortgageAccount.mortgageTerms == null && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">
            Finish setting up {mortgageAccount.name}
          </p>
          <p className="mt-1 text-muted-foreground">
            Add its next payment date and remaining term before using its
            balance in mortgage modelling. The account&apos;s interest rate and
            linked property are already available.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={`/assettracker/accounts?account=${mortgageAccount.id}`}>
              Enter mortgage terms
            </Link>
          </Button>
        </div>
      )}
      {mortgage != null && !rateAvailable && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">
            Add {mortgage.name}&apos;s current interest rate
          </p>
          <p className="mt-1 text-muted-foreground">
            The account currently has a 0% rate, so a repayment figure would
            only divide the balance across the remaining months. Payments and
            interest stay hidden until you enter the real rate.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={`/assettracker/accounts?account=${mortgage.id}`}>
              Enter mortgage rate
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}

function MortgageModelExplanation({
  assumptions,
  existingMortgage,
  mortgageBalance,
  money,
  rateAvailable,
  recordedMortgagePayment,
}: Readonly<{
  assumptions: MortgageCalculatorAssumptions;
  existingMortgage: boolean;
  mortgageBalance: number;
  money: (value: number) => string;
  rateAvailable: boolean;
  recordedMortgagePayment: RecurringFlow | undefined;
}>) {
  if (!existingMortgage) return null;
  return (
    <>
      {rateAvailable && (
        <p className="text-sm text-muted-foreground">
          The modelled payment uses the {money(mortgageBalance)} balance,{" "}
          {(assumptions.initialAnnualRate * 100).toFixed(2)}% interest, and{" "}
          {Number((assumptions.termMonths / 12).toFixed(1))} years remaining.
          {recordedMortgagePayment != null && (
            <>
              {" "}
              Your saved cash-flow payment is{" "}
              {money(monthlyAmount(recordedMortgagePayment, -mortgageBalance))}{" "}
              per month.
            </>
          )}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Investments retained is your current withdrawal capital after any extra
        mortgage repayment in the selected LTV option. Your existing home equity
        is not deducted again. The comparison includes a 60% LTV option.
      </p>
    </>
  );
}

function useMortgageCalculatorState() {
  const {
    accountDetails = [],
    baseCurrency,
    housingPlanningPosition,
    mortgageScenarios = [],
    recurringFlows = [],
    saveMortgageScenario,
  } = useAssetTracker();
  const mortgageAccount = accountDetails.find(
    (account) =>
      account.assetType === "mortgage" &&
      account.isOpen &&
      account.latestBalance != null,
  );
  const property = accountDetails.find(
    (account) => account.id === mortgageAccount?.linkedAccountId,
  );
  const recordedMortgagePayment = recurringFlows.find(
    (flow) => flow.toAccountId === mortgageAccount?.id,
  );
  const mortgage = completeMortgage(mortgageAccount);
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
  const existingMortgage =
    source.mortgageAccountId != null && source.propertyAccountId != null;
  const rateAvailable = !existingMortgage || assumptions.initialAnnualRate > 0;
  const sourceLabel = startingSourceLabel({
    accountDetails,
    defaultLabel: defaults.sourceLabel,
    editedSource,
    mortgageAccount,
  });
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

  function loadScenario(scenario: (typeof mortgageScenarios)[number]) {
    setEditedAssumptions(scenario.assumptions);
    setEditedSource(scenario.source);
    setScenarioName(scenario.name);
    setSaveState("idle");
  }

  return {
    assumptions,
    existingMortgage,
    loadScenario,
    money,
    mortgage,
    mortgageAccount,
    mortgageScenarios,
    rateAvailable,
    recordedMortgagePayment,
    result,
    save,
    saveState,
    scenarioName,
    setEditedAssumptions,
    setSaveState,
    setScenarioName,
    sourceLabel,
  };
}

export function MortgageCalculator() {
  const state = useMortgageCalculatorState();

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Mortgage calculator</CardTitle>
        <CardDescription>
          Compare deposits, repayment terms, rate changes, and overpayments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <MortgageSetupNotices
          mortgage={state.mortgage}
          mortgageAccount={state.mortgageAccount}
          rateAvailable={state.rateAvailable}
        />
        <div className="rounded-md border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Starting facts</p>
          <p className="mt-1 font-medium">{state.sourceLabel}</p>
        </div>
        <MortgageCalculatorHighlights
          existingMortgage={state.existingMortgage}
          rateAvailable={state.rateAvailable}
          result={state.result}
          money={state.money}
        />
        <MortgageModelExplanation
          assumptions={state.assumptions}
          existingMortgage={state.existingMortgage}
          mortgageBalance={state.result.selected.openingLoan}
          money={state.money}
          rateAvailable={state.rateAvailable}
          recordedMortgagePayment={state.recordedMortgagePayment}
        />
        {state.result.selected.fundingShortfall > 0 && (
          <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            This option needs{" "}
            {state.money(state.result.selected.fundingShortfall)} more upfront
            funding.
          </p>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">
            {state.existingMortgage ? "LTV comparison" : "Deposit comparison"}
          </h3>
          <MortgageDepositComparison
            existingMortgage={state.existingMortgage}
            rateAvailable={state.rateAvailable}
            result={state.result}
            money={state.money}
          />
        </div>
        <MortgageCalculatorControls
          assumptions={state.assumptions}
          onChange={(next) => {
            state.setEditedAssumptions(next);
            state.setSaveState("idle");
          }}
        />
        {state.rateAvailable && (
          <>
            <MortgageRateStress result={state.result} money={state.money} />
            <MortgageScheduleDetails
              result={state.result}
              money={state.money}
            />
          </>
        )}

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
              value={state.scenarioName}
              onChange={(event) => {
                state.setScenarioName(event.target.value);
                state.setSaveState("idle");
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={
                state.saveState === "saving" || state.scenarioName.trim() === ""
              }
              onClick={() => void state.save(false)}
            >
              Save scenario
            </Button>
            <Button
              type="button"
              disabled={
                state.saveState === "saving" || state.scenarioName.trim() === ""
              }
              onClick={() => void state.save(true)}
            >
              Record decision
            </Button>
          </div>
          {state.saveState === "saved" && (
            <p className="text-xs text-muted-foreground">
              Saved in this browser.
            </p>
          )}
          {state.saveState === "error" && (
            <p className="text-xs text-destructive">
              The scenario could not be saved.
            </p>
          )}
          {state.mortgageScenarios.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Saved scenarios
              </p>
              <div className="flex flex-wrap gap-2">
                {state.mortgageScenarios.map((scenario) => (
                  <Button
                    key={scenario.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => state.loadScenario(scenario)}
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
