"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/assettracker";
import {
  compareHousingStrategy,
  type HousingPlanningPosition,
  type HousingStrategyAssumptions,
  type HousingStrategyKind,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const STRATEGY_ORDER: HousingStrategyKind[] = [
  "stay",
  "sell-and-rent",
  "downsize",
  "equity-release",
];

const STRATEGY_LABELS: Record<HousingStrategyKind, string> = {
  stay: "Stay",
  "sell-and-rent": "Sell and rent",
  downsize: "Downsize",
  "equity-release": "Equity release",
};

type MoneyField = Exclude<
  keyof HousingStrategyAssumptions,
  "kind" | "moveDate"
>;

function initialAssumptions(
  kind: HousingStrategyKind,
  position: HousingPlanningPosition,
): HousingStrategyAssumptions {
  return {
    kind,
    moveDate: position.asOfDate,
    salePrice:
      kind === "sell-and-rent" || kind === "downsize" ? position.homeValue : 0,
    mortgageSettlement:
      kind === "stay" || kind === "equity-release"
        ? 0
        : position.mortgageBalance,
    transactionCosts: 0,
    taxesAndFees: 0,
    replacementHousingCost: 0,
    annualRent: 0,
    annualOwnershipCost: 0,
    annualBorrowingCost: 0,
    equityReleaseAdvance: 0,
  };
}

function AssumptionInput({
  field,
  label,
  strategy,
  value,
  onChange,
}: Readonly<{
  field: MoneyField;
  label: string;
  strategy: HousingStrategyKind;
  value: number;
  onChange: (field: MoneyField, value: number) => void;
}>) {
  const id = `${strategy}-${field}`;
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        id={id}
        aria-label={`${STRATEGY_LABELS[strategy]} ${label}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="100"
        value={value}
        onChange={(event) => onChange(field, Number(event.target.value) || 0)}
      />
    </label>
  );
}

function AssumptionEditor({
  assumptions,
  onChange,
}: Readonly<{
  assumptions: HousingStrategyAssumptions;
  onChange: (field: MoneyField, value: number) => void;
}>) {
  const common = (
    <>
      <AssumptionInput
        field="transactionCosts"
        label="Transaction costs"
        strategy={assumptions.kind}
        value={assumptions.transactionCosts}
        onChange={onChange}
      />
      <AssumptionInput
        field="taxesAndFees"
        label="Taxes or product fees"
        strategy={assumptions.kind}
        value={assumptions.taxesAndFees}
        onChange={onChange}
      />
    </>
  );

  switch (assumptions.kind) {
    case "stay":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssumptionInput
            field="annualOwnershipCost"
            label="Annual ownership cost"
            strategy={assumptions.kind}
            value={assumptions.annualOwnershipCost}
            onChange={onChange}
          />
          <AssumptionInput
            field="annualBorrowingCost"
            label="Annual borrowing cost"
            strategy={assumptions.kind}
            value={assumptions.annualBorrowingCost}
            onChange={onChange}
          />
        </div>
      );
    case "sell-and-rent":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssumptionInput
            field="salePrice"
            label="Sale price"
            strategy={assumptions.kind}
            value={assumptions.salePrice}
            onChange={onChange}
          />
          <AssumptionInput
            field="mortgageSettlement"
            label="Mortgage settlement"
            strategy={assumptions.kind}
            value={assumptions.mortgageSettlement}
            onChange={onChange}
          />
          {common}
          <AssumptionInput
            field="annualRent"
            label="Annual rent"
            strategy={assumptions.kind}
            value={assumptions.annualRent}
            onChange={onChange}
          />
        </div>
      );
    case "downsize":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssumptionInput
            field="salePrice"
            label="Sale price"
            strategy={assumptions.kind}
            value={assumptions.salePrice}
            onChange={onChange}
          />
          <AssumptionInput
            field="mortgageSettlement"
            label="Mortgage settlement"
            strategy={assumptions.kind}
            value={assumptions.mortgageSettlement}
            onChange={onChange}
          />
          {common}
          <AssumptionInput
            field="replacementHousingCost"
            label="Replacement home"
            strategy={assumptions.kind}
            value={assumptions.replacementHousingCost}
            onChange={onChange}
          />
          <AssumptionInput
            field="annualOwnershipCost"
            label="Annual ownership cost"
            strategy={assumptions.kind}
            value={assumptions.annualOwnershipCost}
            onChange={onChange}
          />
          <AssumptionInput
            field="annualBorrowingCost"
            label="Annual borrowing cost"
            strategy={assumptions.kind}
            value={assumptions.annualBorrowingCost}
            onChange={onChange}
          />
        </div>
      );
    case "equity-release":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssumptionInput
            field="equityReleaseAdvance"
            label="Gross equity advance"
            strategy={assumptions.kind}
            value={assumptions.equityReleaseAdvance}
            onChange={onChange}
          />
          {common}
          <AssumptionInput
            field="annualOwnershipCost"
            label="Annual ownership cost"
            strategy={assumptions.kind}
            value={assumptions.annualOwnershipCost}
            onChange={onChange}
          />
          <AssumptionInput
            field="annualBorrowingCost"
            label="Annual borrowing cost"
            strategy={assumptions.kind}
            value={assumptions.annualBorrowingCost}
            onChange={onChange}
          />
        </div>
      );
  }
}

export function HousingStrategyPlanner() {
  const { baseCurrency, housingPlanningPosition } = useAssetTracker();
  const [assumptions, setAssumptions] = useState<
    HousingStrategyAssumptions[] | null
  >(null);
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [annualNonHousingExpenditure, setAnnualNonHousingExpenditure] =
    useState<number | null>(null);

  if (housingPlanningPosition == null) return null;

  const position = {
    ...housingPlanningPosition,
    annualNonHousingExpenditure:
      annualNonHousingExpenditure ??
      housingPlanningPosition.annualNonHousingExpenditure,
  };
  const selectedMoveDate = moveDate ?? position.asOfDate;
  const currentAssumptions =
    assumptions ??
    STRATEGY_ORDER.map((kind) => initialAssumptions(kind, position));
  const outcomes = currentAssumptions.map((scenario) =>
    compareHousingStrategy(position, {
      ...scenario,
      moveDate: scenario.kind === "stay" ? position.asOfDate : selectedMoveDate,
    }),
  );
  const stay = outcomes[0];

  function updateScenario(
    kind: HousingStrategyKind,
    field: MoneyField,
    value: number,
  ) {
    setAssumptions(
      currentAssumptions.map((scenario) =>
        scenario.kind === kind ? { ...scenario, [field]: value } : scenario,
      ),
    );
  }

  const warnings = (() => {
    const messages: string[] = [];
    if (selectedMoveDate < position.asOfDate) {
      messages.push("Move date cannot be before the household position date.");
    }
    for (const outcome of outcomes) {
      if (outcome.fundingShortfall) {
        messages.push(
          `${outcome.label} requires more funding than the strategy provides. Check the advance or replacement financing.`,
        );
      }
      if (outcome.annualSavings < 0) {
        messages.push(
          `${outcome.label} spends more than the modelled annual income.`,
        );
      }
    }
    return messages;
  })();

  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);
  const fiDate = (date: string | null) =>
    date == null ? ">100 years" : format(parseISO(date), "MMM yyyy");

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Housing strategy comparison</CardTitle>
        <CardDescription>
          Compare every strategy from the {position.asOfDate} household
          position. Home equity remains in net worth. Only released cash enters
          withdrawal capital.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Recorded home value</p>
            <p className="mt-1 font-semibold">{money(position.homeValue)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Mortgage balance</p>
            <p className="mt-1 font-semibold">
              {money(position.mortgageBalance)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Total home equity</p>
            <p className="mt-1 font-semibold">{money(position.homeEquity)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              Current withdrawal capital
            </p>
            <p className="mt-1 font-semibold">
              {money(position.withdrawalCapital)}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="housing-move-date"
            className="space-y-1 text-xs text-muted-foreground"
          >
            <span>Move or transaction date</span>
            <Input
              id="housing-move-date"
              aria-label="Housing move date"
              type="date"
              min={position.asOfDate}
              value={selectedMoveDate}
              onChange={(event) =>
                setMoveDate(
                  event.target.value === "" ? null : event.target.value,
                )
              }
            />
          </label>
          <label
            htmlFor="annual-non-housing-spending"
            className="space-y-1 text-xs text-muted-foreground"
          >
            <span>Annual non-housing spending assumption</span>
            <Input
              id="annual-non-housing-spending"
              aria-label="Annual non-housing spending assumption"
              type="number"
              inputMode="decimal"
              min="0"
              step="100"
              value={position.annualNonHousingExpenditure}
              onChange={(event) =>
                setAnnualNonHousingExpenditure(Number(event.target.value) || 0)
              }
            />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {currentAssumptions.map((scenario) => (
            <details className="rounded-md border p-4" key={scenario.kind}>
              <summary className="cursor-pointer text-sm font-medium">
                {STRATEGY_LABELS[scenario.kind]} assumptions
              </summary>
              <div className="mt-3">
                <AssumptionEditor
                  assumptions={scenario}
                  onChange={(field, value) =>
                    updateScenario(scenario.kind, field, value)
                  }
                />
              </div>
            </details>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Values start at zero when the tracker cannot derive them. Replace them
          with a lender quote, tenancy quote, conveyancing estimate, and the tax
          or fee rules that apply to you. The model does not infer legal, tax,
          or product terms. Equity release is a new loan secured against the
          current home. Its cash and debt offset in net worth before fees.
        </p>

        {warnings.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 p-3 text-sm"
          >
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table
            className="w-full min-w-[1500px] text-sm"
            aria-label="Housing strategy comparison"
          >
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 text-right font-medium">Sale</th>
                <th className="px-3 py-2 text-right font-medium">
                  Mortgage settlement
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Transaction costs
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Taxes / fees
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Replacement home
                </th>
                <th className="px-3 py-2 text-right font-medium">Rent / yr</th>
                <th className="px-3 py-2 text-right font-medium">
                  Ownership / yr
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Borrowing / yr
                </th>
                <th className="px-3 py-2 text-right font-medium">Released</th>
                <th className="px-3 py-2 text-right font-medium">Retained</th>
                <th className="px-3 py-2 text-right font-medium">Net worth</th>
                <th className="px-3 py-2 text-right font-medium">
                  Withdrawal capital
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  FI spending / yr
                </th>
                <th className="px-3 py-2 text-right font-medium">FI target</th>
                <th className="px-3 py-2 font-medium">Projected FI</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome) => (
                <tr className="border-t" key={outcome.kind}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-medium"
                  >
                    {outcome.label}
                  </th>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.salePrice)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.mortgageSettlement)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.transactionCosts)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.taxesAndFees)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.replacementHousingCost)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.annualRent)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.annualOwnershipCost)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.annualBorrowingCost)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.releasedCapital)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.retainedEquity)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.totalNetWorth)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.withdrawalCapital)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.annualExpenditure)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(outcome.fiTarget)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {fiDate(outcome.projectedFiDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {outcomes.map((outcome) => (
            <div className="rounded-md border p-3" key={outcome.kind}>
              <h3 className="text-sm font-medium">{outcome.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Compared with staying, net worth changes by{" "}
                {money(outcome.totalNetWorth - (stay?.totalNetWorth ?? 0))},
                withdrawal capital by{" "}
                {money(
                  outcome.withdrawalCapital - (stay?.withdrawalCapital ?? 0),
                )}
                , and annual FI spending by{" "}
                {money(
                  outcome.annualExpenditure - (stay?.annualExpenditure ?? 0),
                )}
                . Those changes drive the FI target and date.
              </p>
              <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                {outcome.timeline.map((phase) => (
                  <li key={`${phase.startDate}:${phase.housingState}`}>
                    {phase.startDate}
                    {phase.endDate == null
                      ? " onward"
                      : ` until ${phase.endDate}`}
                    : {phase.housingState}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
