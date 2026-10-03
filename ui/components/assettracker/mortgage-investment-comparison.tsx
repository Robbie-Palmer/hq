"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
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
  advanceMortgageTerms,
  buildMortgageInvestmentSensitivity,
  compareMortgageOverpaymentWithInvestment,
  type MortgageInvestmentComparisonInput,
  type MortgageInvestmentOutcome,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

type EditableAssumptions = Pick<
  MortgageInvestmentComparisonInput,
  | "availableCapital"
  | "monthlySurplus"
  | "horizonMonths"
  | "investmentAnnualReturn"
  | "investmentVolatility"
  | "investmentStressMultiple"
  | "investmentTaxRate"
  | "investmentAnnualFeeRate"
  | "penaltyFreeOverpayment"
  | "overpaymentChargeRate"
>;

type AssumptionField = keyof EditableAssumptions;

const PERCENT_FIELDS = new Set<AssumptionField>([
  "investmentAnnualReturn",
  "investmentVolatility",
  "investmentTaxRate",
  "investmentAnnualFeeRate",
  "overpaymentChargeRate",
]);

function AssumptionInput({
  field,
  label,
  value,
  onChange,
}: Readonly<{
  field: AssumptionField;
  label: string;
  value: number;
  onChange: (field: AssumptionField, value: number) => void;
}>) {
  const percent = PERCENT_FIELDS.has(field);
  const id = `mortgage-investment-${field}`;
  let step = "100";
  if (percent) step = "0.1";
  else if (field === "horizonMonths") step = "12";
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={percent ? value * 100 : value}
        onChange={(event) =>
          onChange(
            field,
            (Number(event.target.value) || 0) / (percent ? 100 : 1),
          )
        }
      />
    </label>
  );
}

function CompactResultRow({
  outcome,
  money,
  fiDate,
}: Readonly<{
  outcome: MortgageInvestmentOutcome;
  money: (value: number) => string;
  fiDate: (value: string | null) => string;
}>) {
  return (
    <tr className="border-t">
      <th
        scope="row"
        className="whitespace-nowrap px-3 py-3 text-left font-medium"
      >
        {outcome.label}
      </th>
      <td className="px-3 py-3 text-right font-medium">
        {money(outcome.netWorth)}
      </td>
      <td className="px-3 py-3 text-right">{money(outcome.liquidAssets)}</td>
      <td className="px-3 py-3 text-right">{money(outcome.mortgageBalance)}</td>
      <td className="px-3 py-3 text-right">{money(outcome.interestPaid)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        {fiDate(outcome.projectedFiDate)}
      </td>
    </tr>
  );
}

function DetailedResultRow({
  outcome,
  money,
  fiDate,
}: Readonly<{
  outcome: MortgageInvestmentOutcome;
  money: (value: number) => string;
  fiDate: (value: string | null) => string;
}>) {
  return (
    <tr className="border-t">
      <th
        scope="row"
        className="whitespace-nowrap px-3 py-2 text-left font-medium"
      >
        {outcome.label}
      </th>
      <td className="px-3 py-2 text-right">{money(outcome.mortgageBalance)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {format(parseISO(outcome.mortgagePayoffDate), "MMM yyyy")}
      </td>
      <td className="px-3 py-2 text-right">{money(outcome.interestPaid)}</td>
      <td className="px-3 py-2 text-right">
        {money(outcome.mortgageFeesAndCharges)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.firstYearMortgageCashRequired)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.investmentBalance)}
      </td>
      <td className="px-3 py-2 text-right">{money(outcome.liquidAssets)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.propertyValue)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.homeEquity)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.netWorth)}</td>
      <td className="px-3 py-2 text-right">
        {money(outcome.stressedNetWorth)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.drawdownExposure)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {fiDate(outcome.projectedFiDate)}
      </td>
    </tr>
  );
}

export function MortgageInvestmentComparison() {
  const {
    accountDetails = [],
    baseCurrency,
    housingPlanningPosition: position,
  } = useAssetTracker();
  const [edited, setEdited] = useState<EditableAssumptions | null>(null);
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

  const model = useMemo(() => {
    if (
      mortgage?.latestBalance == null ||
      mortgage.latestSnapshotDate == null ||
      mortgage.mortgageTerms == null ||
      property?.latestBalance == null ||
      position == null
    ) {
      return null;
    }
    const terms = advanceMortgageTerms(
      mortgage.mortgageTerms,
      mortgage.latestSnapshotDate,
    );
    const availableCapital = Math.min(
      Math.max(position.withdrawalCapital, 0),
      25_000,
    );
    const defaults: EditableAssumptions = {
      availableCapital,
      monthlySurplus: Math.round(
        Math.max(
          (position.annualInvestableIncome -
            position.annualNonHousingExpenditure -
            position.annualMortgageExpenditureRemoved) /
            12,
          0,
        ),
      ),
      horizonMonths: Math.min(terms.remainingTermMonths, 120),
      investmentAnnualReturn: 0.05,
      investmentVolatility: 0.15,
      investmentStressMultiple: 1,
      investmentTaxRate: 0,
      investmentAnnualFeeRate: 0.0025,
      penaltyFreeOverpayment:
        terms.overpaymentAllowance?.amount ??
        Math.abs(mortgage.latestBalance) * 0.1,
      overpaymentChargeRate: terms.overpaymentAllowance?.chargeRate ?? 0.01,
    };
    const assumptions = edited ?? defaults;
    const input: MortgageInvestmentComparisonInput = {
      asOfDate: position.asOfDate,
      openingMortgageBalance: mortgage.latestBalance,
      initialMortgageRate: mortgage.expectedAnnualReturn,
      rateChanges: mortgage.expectedReturnChanges ?? [],
      mortgageTerms: terms,
      propertyValue: Math.max(property.latestBalance, 0),
      propertyAnnualReturn: property.expectedAnnualReturn,
      availableCapital: assumptions.availableCapital,
      monthlySurplus: assumptions.monthlySurplus,
      otherLiquidAssets: Math.max(
        position.withdrawalCapital - assumptions.availableCapital,
        0,
      ),
      otherNetWorth:
        position.totalNetWorth -
        position.homeEquity -
        position.withdrawalCapital,
      annualSpendingAfterMortgage: position.annualNonHousingExpenditure,
      withdrawalRate: position.withdrawalRate,
      horizonMonths: Math.max(Math.round(assumptions.horizonMonths), 1),
      investmentAnnualReturn: assumptions.investmentAnnualReturn,
      investmentVolatility: assumptions.investmentVolatility,
      investmentStressMultiple: assumptions.investmentStressMultiple,
      investmentTaxRate: assumptions.investmentTaxRate,
      investmentAnnualFeeRate: assumptions.investmentAnnualFeeRate,
      penaltyFreeOverpayment: assumptions.penaltyFreeOverpayment,
      overpaymentChargeRate: assumptions.overpaymentChargeRate,
    };
    return {
      assumptions,
      input,
      comparison: compareMortgageOverpaymentWithInvestment(input),
      sensitivity: buildMortgageInvestmentSensitivity(
        input,
        [
          Math.max(input.initialMortgageRate - 0.02, 0),
          input.initialMortgageRate,
          input.initialMortgageRate + 0.02,
        ],
        [
          input.investmentAnnualReturn - input.investmentVolatility,
          input.investmentAnnualReturn,
          input.investmentAnnualReturn + input.investmentVolatility,
        ],
      ),
    };
  }, [edited, mortgage, position, property]);

  if (model == null) return null;

  const { assumptions, comparison, sensitivity } = model;
  function update(field: AssumptionField, value: number) {
    setEdited({ ...assumptions, [field]: value });
  }

  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const fiDate = (value: string | null) =>
    value == null ? "Beyond horizon" : format(parseISO(value), "MMM yyyy");
  const advantage = comparison.invest.netWorth - comparison.overpay.netWorth;
  const stressedAdvantage =
    comparison.invest.stressedNetWorth - comparison.overpay.stressedNetWorth;
  const winner = advantage >= 0 ? comparison.invest : comparison.overpay;
  const stressedWinner =
    stressedAdvantage >= 0 ? comparison.invest : comparison.overpay;
  const horizonYears = model.input.horizonMonths / 12;
  const horizonLabel = Number.isInteger(horizonYears)
    ? `${horizonYears} years`
    : `${model.input.horizonMonths} months`;
  const investmentReturns = [
    model.input.investmentAnnualReturn - model.input.investmentVolatility,
    model.input.investmentAnnualReturn,
    model.input.investmentAnnualReturn + model.input.investmentVolatility,
  ];
  const mortgageRates = [
    Math.max(model.input.initialMortgageRate - 0.02, 0),
    model.input.initialMortgageRate,
    model.input.initialMortgageRate + 0.02,
  ];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Mortgage overpayment or investment</CardTitle>
        <CardDescription>
          See which choice leaves the household better off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">At {horizonLabel}</p>
            <p className="mt-1 font-semibold">{money(Math.abs(advantage))}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {winner.label} leads
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Break-even return</p>
            <p className="mt-1 font-semibold">
              {comparison.breakEvenInvestmentReturn == null
                ? "Outside model range"
                : percent(comparison.breakEvenInvestmentReturn)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Stress case</p>
            <p className="mt-1 font-semibold">
              {money(Math.abs(stressedAdvantage))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stressedWinner.label} leads
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table
            className="w-full min-w-[760px] text-sm"
            aria-label="Mortgage strategy summary"
          >
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 text-right font-medium">Net worth</th>
                <th className="px-3 py-2 text-right font-medium">
                  Liquid assets
                </th>
                <th className="px-3 py-2 text-right font-medium">Mortgage</th>
                <th className="px-3 py-2 text-right font-medium">Interest</th>
                <th className="px-3 py-2 font-medium">Projected FI</th>
              </tr>
            </thead>
            <tbody>
              <CompactResultRow
                outcome={comparison.overpay}
                money={money}
                fiDate={fiDate}
              />
              <CompactResultRow
                outcome={comparison.invest}
                money={money}
                fiDate={fiDate}
              />
            </tbody>
          </table>
        </div>

        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Adjust assumptions
          </summary>
          <div className="mt-4 space-y-5">
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                Plan
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <AssumptionInput
                  field="availableCapital"
                  label="Capital available now"
                  value={model.assumptions.availableCapital}
                  onChange={update}
                />
                <AssumptionInput
                  field="monthlySurplus"
                  label="Monthly surplus"
                  value={model.assumptions.monthlySurplus}
                  onChange={update}
                />
                <AssumptionInput
                  field="horizonMonths"
                  label="Comparison horizon, months"
                  value={model.assumptions.horizonMonths}
                  onChange={update}
                />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                Investment
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <AssumptionInput
                  field="investmentAnnualReturn"
                  label="Annual return"
                  value={model.assumptions.investmentAnnualReturn}
                  onChange={update}
                />
                <AssumptionInput
                  field="investmentVolatility"
                  label="Stress range"
                  value={model.assumptions.investmentVolatility}
                  onChange={update}
                />
                <AssumptionInput
                  field="investmentStressMultiple"
                  label="Stress multiple"
                  value={model.assumptions.investmentStressMultiple}
                  onChange={update}
                />
                <AssumptionInput
                  field="investmentAnnualFeeRate"
                  label="Annual fee"
                  value={model.assumptions.investmentAnnualFeeRate}
                  onChange={update}
                />
                <AssumptionInput
                  field="investmentTaxRate"
                  label="Tax on gains"
                  value={model.assumptions.investmentTaxRate}
                  onChange={update}
                />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                Mortgage product
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <AssumptionInput
                  field="penaltyFreeOverpayment"
                  label="Penalty-free overpayment"
                  value={model.assumptions.penaltyFreeOverpayment}
                  onChange={update}
                />
                <AssumptionInput
                  field="overpaymentChargeRate"
                  label="Charge above allowance"
                  value={model.assumptions.overpaymentChargeRate}
                  onChange={update}
                />
              </div>
            </div>
          </div>
        </details>

        <div>
          <h3 className="text-sm font-medium">Rate sensitivity</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Positive values favour investing. Negative values favour overpaying.
          </p>
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table
              className="w-full min-w-[560px] text-sm"
              aria-label="Mortgage and investment return sensitivity"
            >
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    Mortgage rate
                  </th>
                  {investmentReturns.map((rate, index) => (
                    <th
                      className="px-3 py-2 text-right font-medium"
                      key={`${rate}:${index}`}
                    >
                      Investment {percent(rate)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mortgageRates.map((mortgageRate, mortgageRateIndex) => (
                  <tr
                    className="border-t"
                    key={`${mortgageRate}:${mortgageRateIndex}`}
                  >
                    <th className="px-3 py-2 text-left font-medium">
                      {percent(mortgageRate)}
                    </th>
                    {investmentReturns.map((investmentReturn, returnIndex) => {
                      const cell = sensitivity.find(
                        (entry) =>
                          entry.mortgageRate === mortgageRate &&
                          entry.investmentReturn === investmentReturn,
                      );
                      return (
                        <td
                          className="px-3 py-2 text-right"
                          key={`${investmentReturn}:${returnIndex}`}
                        >
                          {money(cell?.investNetWorthAdvantage ?? 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            All calculated measures
          </summary>
          <div className="mt-4 overflow-x-auto rounded-md border">
            <table
              className="w-full min-w-[1450px] text-sm"
              aria-label="Detailed mortgage strategy results"
            >
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Strategy</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Mortgage at horizon
                  </th>
                  <th className="px-3 py-2 font-medium">Payoff</th>
                  <th className="px-3 py-2 text-right font-medium">Interest</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Fees / charges
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Mortgage cash, first year
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Strategy investment
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Liquid assets
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Property</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Home equity
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Net worth
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Stressed net worth
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Drawdown exposure
                  </th>
                  <th className="px-3 py-2 font-medium">Projected FI</th>
                </tr>
              </thead>
              <tbody>
                <DetailedResultRow
                  outcome={comparison.overpay}
                  money={money}
                  fiDate={fiDate}
                />
                <DetailedResultRow
                  outcome={comparison.invest}
                  money={money}
                  fiDate={fiDate}
                />
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
