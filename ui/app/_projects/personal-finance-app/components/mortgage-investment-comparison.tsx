"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/app/_projects/personal-finance-app/lib";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAssetTracker } from "./asset-tracker-provider";
import { selectAssetTrackerFields } from "./asset-tracker-selectors";
import { HousingValueDisclosure } from "./housing-value-disclosure";
import {
  MortgageInvestmentAssumptionControls,
  type MortgageInvestmentAssumptionField,
  type MortgageInvestmentAssumptions,
} from "./mortgage-investment-assumptions";
import { MortgageInvestmentDetails } from "./mortgage-investment-details";
import {
  buildMortgageInvestmentModel,
  type MortgageInvestmentModel,
} from "./mortgage-investment-model";
import {
  MortgageInvestmentHighlights,
  MortgageInvestmentSummary,
} from "./mortgage-investment-results";
import { MortgageInvestmentSensitivityTable } from "./mortgage-investment-sensitivity";

const selectMortgageInvestmentComparison = selectAssetTrackerFields(
  "accountDetails",
  "baseCurrency",
  "housingPlanningPosition",
);

function MortgageValuationBasis({
  model,
}: Readonly<{ model: MortgageInvestmentModel }>) {
  const { baseCurrency, housingPlanningPosition } = useAssetTracker(
    ({ baseCurrency, housingPlanningPosition }) => ({
      baseCurrency,
      housingPlanningPosition,
    }),
  );
  const values = housingPlanningPosition?.valuationBasis ?? [];
  if (values.length === 0) return null;
  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Property value used in this comparison
      </summary>
      <div className="mt-3 grid gap-2">
        {values.map((value) => (
          <HousingValueDisclosure key={value.id} value={value} compact />
        ))}
        <p className="text-xs text-muted-foreground">
          At the valuation range, projected overpay net worth is{" "}
          {money(model.valuationSensitivity.lower.overpay.netWorth)} to{" "}
          {money(model.valuationSensitivity.upper.overpay.netWorth)}. Projected
          invest net worth is{" "}
          {money(model.valuationSensitivity.lower.invest.netWorth)} to{" "}
          {money(model.valuationSensitivity.upper.invest.netWorth)}. Investment
          return and future property growth remain separate, editable
          assumptions.
        </p>
      </div>
    </details>
  );
}

export function MortgageInvestmentComparison() {
  const {
    accountDetails = [],
    baseCurrency,
    housingPlanningPosition: position,
  } = useAssetTracker(selectMortgageInvestmentComparison);
  const [editedAssumptions, setEditedAssumptions] =
    useState<MortgageInvestmentAssumptions | null>(null);
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
  const model = useMemo(
    () =>
      buildMortgageInvestmentModel({
        editedAssumptions,
        mortgage,
        position,
        property,
      }),
    [editedAssumptions, mortgage, position, property],
  );
  if (model == null || model.input.initialMortgageRate <= 0) return null;
  const currentModel = model;

  function update(field: MortgageInvestmentAssumptionField, value: number) {
    setEditedAssumptions({ ...currentModel.assumptions, [field]: value });
  }

  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const fiDate = (value: string | null) =>
    value == null ? "Beyond horizon" : format(parseISO(value), "MMM yyyy");
  const horizonYears = currentModel.input.horizonMonths / 12;
  const horizonLabel = Number.isInteger(horizonYears)
    ? `${horizonYears} years`
    : `${currentModel.input.horizonMonths} months`;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Mortgage overpayment or investment</CardTitle>
        <CardDescription>
          See which choice leaves the household better off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <MortgageValuationBasis model={currentModel} />
        <MortgageInvestmentHighlights
          comparison={currentModel.comparison}
          horizonLabel={horizonLabel}
          money={money}
          percent={percent}
        />
        <MortgageInvestmentSummary
          comparison={currentModel.comparison}
          money={money}
          fiDate={fiDate}
        />
        <MortgageInvestmentAssumptionControls
          assumptions={currentModel.assumptions}
          onChange={update}
        />
        <MortgageInvestmentSensitivityTable
          sensitivity={currentModel.sensitivity}
          mortgageRates={currentModel.mortgageRates}
          investmentReturns={currentModel.investmentReturns}
          money={money}
          percent={percent}
        />
        <MortgageInvestmentDetails
          comparison={currentModel.comparison}
          money={money}
          fiDate={fiDate}
        />
      </CardContent>
    </Card>
  );
}
