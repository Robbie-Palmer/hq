import {
  type AccountDetailView,
  advanceMortgageTerms,
  buildMortgageInvestmentSensitivity,
  compareMortgageOverpaymentWithInvestment,
  type HousingPlanningPosition,
  type MortgageInvestmentComparison,
  type MortgageInvestmentComparisonInput,
  type MortgageInvestmentSensitivity,
  type MortgageTerms,
} from "@/lib/domain/assettracker";
import type { MortgageInvestmentAssumptions } from "./mortgage-investment-assumptions";

export type MortgageInvestmentModel = {
  assumptions: MortgageInvestmentAssumptions;
  input: MortgageInvestmentComparisonInput;
  comparison: MortgageInvestmentComparison;
  sensitivity: MortgageInvestmentSensitivity[];
  mortgageRates: number[];
  investmentReturns: number[];
};

function defaultAssumptions(
  mortgage: AccountDetailView,
  position: HousingPlanningPosition,
  terms: MortgageTerms,
): MortgageInvestmentAssumptions | null {
  if (
    mortgage.latestBalance == null ||
    mortgage.latestSnapshotDate == null ||
    mortgage.mortgageTerms == null
  ) {
    return null;
  }
  return {
    availableCapital: Math.min(Math.max(position.withdrawalCapital, 0), 25_000),
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
}

export function buildMortgageInvestmentModel({
  editedAssumptions,
  mortgage,
  position,
  property,
}: {
  editedAssumptions: MortgageInvestmentAssumptions | null;
  mortgage: AccountDetailView | undefined;
  position: HousingPlanningPosition | null | undefined;
  property: AccountDetailView | undefined;
}): MortgageInvestmentModel | null {
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
  const defaults = defaultAssumptions(mortgage, position, terms);
  if (defaults == null) return null;
  const assumptions = editedAssumptions ?? defaults;
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
      position.totalNetWorth - position.homeEquity - position.withdrawalCapital,
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
  const mortgageRates = [
    Math.max(input.initialMortgageRate - 0.02, 0),
    input.initialMortgageRate,
    input.initialMortgageRate + 0.02,
  ];
  const investmentReturns = [
    input.investmentAnnualReturn - input.investmentVolatility,
    input.investmentAnnualReturn,
    input.investmentAnnualReturn + input.investmentVolatility,
  ];
  return {
    assumptions,
    input,
    comparison: compareMortgageOverpaymentWithInvestment(input),
    sensitivity: buildMortgageInvestmentSensitivity(
      input,
      mortgageRates,
      investmentReturns,
    ),
    mortgageRates,
    investmentReturns,
  };
}
