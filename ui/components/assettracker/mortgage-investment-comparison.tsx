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
import { formatCurrency } from "@/lib/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  MortgageInvestmentAssumptionControls,
  type MortgageInvestmentAssumptionField,
  type MortgageInvestmentAssumptions,
} from "./mortgage-investment-assumptions";
import { MortgageInvestmentDetails } from "./mortgage-investment-details";
import { buildMortgageInvestmentModel } from "./mortgage-investment-model";
import {
  MortgageInvestmentHighlights,
  MortgageInvestmentSummary,
} from "./mortgage-investment-results";
import { MortgageInvestmentSensitivityTable } from "./mortgage-investment-sensitivity";

export function MortgageInvestmentComparison() {
  const {
    accountDetails = [],
    baseCurrency,
    housingPlanningPosition: position,
  } = useAssetTracker();
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

  if (model == null) return null;
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
