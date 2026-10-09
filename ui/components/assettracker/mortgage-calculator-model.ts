import { addMonths, addYears, format, parseISO } from "date-fns";
import type {
  AccountDetailView,
  HousingPlanningPosition,
  MortgageCalculatorAssumptions,
  MortgageScenarioSource,
} from "@/lib/domain/assettracker";
import {
  advanceMortgageTerms,
  effectiveExpectedReturn,
} from "@/lib/domain/assettracker";

export type MortgageCalculatorModel = {
  assumptions: MortgageCalculatorAssumptions;
  source: MortgageScenarioSource;
  sourceLabel: string;
};

function hypotheticalDefaults(asOfDate: string): MortgageCalculatorModel {
  const firstPaymentDate = format(
    addMonths(parseISO(asOfDate), 1),
    "yyyy-MM-dd",
  );
  return {
    source: {},
    sourceLabel: "Hypothetical mortgage",
    assumptions: {
      purchasePrice: 300_000,
      availableFunds: 75_000,
      depositAmount: 60_000,
      initialAnnualRate: 0.05,
      termMonths: 300,
      repaymentType: "repayment",
      accrualStartDate: asOfDate,
      firstPaymentDate,
      fixedPeriodEnd: format(
        addYears(parseISO(firstPaymentDate), 5),
        "yyyy-MM-dd",
      ),
      followOnAnnualRate: 0.06,
      refinanceFee: 999,
      purchaseFees: 0,
      taxes: 0,
      transactionCosts: 2_500,
      monthlyOverpayment: 0,
      overpaymentAllowance: 24_000,
      overpaymentChargeRate: 0.05,
    },
  };
}

export function buildMortgageCalculatorModel(input: {
  asOfDate: string;
  mortgage: AccountDetailView | undefined;
  property: AccountDetailView | undefined;
  position: HousingPlanningPosition | null | undefined;
}): MortgageCalculatorModel {
  const { mortgage, property, position } = input;
  if (
    mortgage?.latestBalance == null ||
    mortgage.latestSnapshotDate == null ||
    mortgage.mortgageTerms == null ||
    property?.latestBalance == null
  ) {
    return hypotheticalDefaults(input.asOfDate);
  }
  const terms = advanceMortgageTerms(
    mortgage.mortgageTerms,
    mortgage.latestSnapshotDate,
  );
  const propertyValue = Math.max(property.latestBalance, 1);
  const mortgageBalance = Math.abs(mortgage.latestBalance);
  const depositAmount = Math.max(propertyValue - mortgageBalance, 0);
  const currentRate = effectiveExpectedReturn(mortgage, terms.firstPaymentDate);
  const nextRateChange = (mortgage.expectedReturnChanges ?? [])
    .filter((change) => change.date > terms.firstPaymentDate)
    .toSorted((a, b) => a.date.localeCompare(b.date))[0];
  const refinanceFee =
    terms.fees.find((fee) => fee.date === nextRateChange?.date)?.amount ?? 0;
  return {
    source: {
      mortgageAccountId: mortgage.id,
      propertyAccountId: property.id,
      snapshotDate: mortgage.latestSnapshotDate,
    },
    sourceLabel: `${mortgage.name} and ${property.name} at ${mortgage.latestSnapshotDate}`,
    assumptions: {
      purchasePrice: propertyValue,
      availableFunds:
        depositAmount + Math.max(position?.withdrawalCapital ?? 0, 0),
      depositAmount,
      initialAnnualRate: Math.max(currentRate, 0),
      termMonths: terms.remainingTermMonths,
      repaymentType: "repayment",
      accrualStartDate: mortgage.latestSnapshotDate,
      firstPaymentDate: terms.firstPaymentDate,
      ...(nextRateChange == null
        ? {}
        : { fixedPeriodEnd: nextRateChange.date }),
      followOnAnnualRate: Math.max(nextRateChange?.rate ?? currentRate, 0),
      refinanceFee,
      purchaseFees: 0,
      taxes: 0,
      transactionCosts: 0,
      monthlyOverpayment: 0,
      overpaymentAllowance:
        terms.overpaymentAllowance?.amount ?? mortgageBalance * 0.1,
      overpaymentChargeRate: terms.overpaymentAllowance?.chargeRate ?? 0.01,
    },
  };
}
