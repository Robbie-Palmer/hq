import type { MortgageRateChange, MortgageTerms } from "./mortgage";

export type MortgageInvestmentStrategy = "overpay" | "invest";

export type MortgageInvestmentComparisonInput = {
  asOfDate: string;
  openingMortgageBalance: number;
  initialMortgageRate: number;
  rateChanges: readonly MortgageRateChange[];
  mortgageTerms: MortgageTerms;
  propertyValue: number;
  propertyAnnualReturn: number;
  availableCapital: number;
  monthlySurplus: number;
  otherLiquidAssets: number;
  otherNetWorth: number;
  annualSpendingAfterMortgage: number;
  withdrawalRate: number;
  horizonMonths: number;
  investmentAnnualReturn: number;
  investmentVolatility: number;
  investmentStressMultiple: number;
  investmentTaxRate: number;
  investmentAnnualFeeRate: number;
  penaltyFreeOverpayment: number;
  overpaymentChargeRate: number;
};

export type MortgageInvestmentPoint = {
  date: string;
  mortgageBalance: number;
  investmentBalance: number;
  stressedInvestmentBalance: number;
  liquidAssets: number;
  stressedLiquidAssets: number;
  propertyValue: number;
  homeEquity: number;
  netWorth: number;
  stressedNetWorth: number;
};

export type MortgageInvestmentOutcome = {
  strategy: MortgageInvestmentStrategy;
  label: string;
  lumpSumOverpayment: number;
  overpaymentCharge: number;
  mortgageBalance: number;
  mortgagePayoffDate: string;
  interestPaid: number;
  mortgageFeesAndCharges: number;
  firstYearMortgageCashRequired: number;
  investmentBalance: number;
  stressedInvestmentBalance: number;
  liquidAssets: number;
  stressedLiquidAssets: number;
  propertyValue: number;
  homeEquity: number;
  netWorth: number;
  stressedNetWorth: number;
  drawdownExposure: number;
  projectedFiDate: string | null;
  stressedProjectedFiDate: string | null;
  timeline: MortgageInvestmentPoint[];
};

export type MortgageInvestmentComparison = {
  input: MortgageInvestmentComparisonInput;
  netInvestmentReturn: number;
  stressedInvestmentReturn: number;
  overpay: MortgageInvestmentOutcome;
  invest: MortgageInvestmentOutcome;
  breakEvenInvestmentReturn: number | null;
};

export type MortgageInvestmentSensitivity = {
  mortgageRate: number;
  investmentReturn: number;
  investNetWorthAdvantage: number;
};
