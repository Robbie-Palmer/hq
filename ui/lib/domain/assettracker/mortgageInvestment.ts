import { addMonths, format, parseISO } from "date-fns";
import {
  buildMortgageSchedule,
  type MortgageRateChange,
  type MortgageScheduleRow,
  type MortgageTerms,
} from "./mortgage";

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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function afterTaxAndFeesReturn(
  annualReturn: number,
  annualFeeRate: number,
  taxRate: number,
): number {
  const afterFees = annualReturn - annualFeeRate;
  return Math.max(afterFees - Math.max(afterFees, 0) * taxRate, -0.99);
}

function monthlyRate(annualRate: number): number {
  return (1 + Math.max(annualRate, -0.99)) ** (1 / 12) - 1;
}

function overpaymentFundedByCapital(
  input: MortgageInvestmentComparisonInput,
  maximumOverpayment: number,
) {
  const available = Math.max(input.availableCapital, 0);
  const allowance = Math.max(input.penaltyFreeOverpayment, 0);
  const chargeRate = Math.max(input.overpaymentChargeRate, 0);
  const affordableBeforeBalance =
    available <= allowance || chargeRate === 0
      ? available
      : allowance + (available - allowance) / (1 + chargeRate);
  const overpayment = Math.min(affordableBeforeBalance, maximumOverpayment);
  const charge = Math.max(overpayment - allowance, 0) * chargeRate;
  return {
    overpayment: roundMoney(overpayment),
    charge: roundMoney(charge),
    remainingCapital: roundMoney(Math.max(available - overpayment - charge, 0)),
  };
}

function addDatedAmount(
  entries: readonly { date: string; amount: number }[],
  date: string,
  amount: number,
) {
  if (amount <= 0) return [...entries];
  return [...entries, { date, amount }];
}

type ScenarioSetup = {
  schedule: MortgageScheduleRow[];
  retainedSchedule: MortgageScheduleRow[];
  lumpSumOverpayment: number;
  overpaymentCharge: number;
  openingInvestment: number;
};

function prepareScenario(
  input: MortgageInvestmentComparisonInput,
  strategy: MortgageInvestmentStrategy,
): ScenarioSetup {
  const retainedSchedule = buildMortgageSchedule({
    openingBalance: input.openingMortgageBalance,
    initialAnnualRate: input.initialMortgageRate,
    rateChanges: input.rateChanges,
    terms: input.mortgageTerms,
  });
  const maximumOverpayment =
    Math.ceil(
      Math.max(
        Math.abs(input.openingMortgageBalance) -
          (retainedSchedule[0]?.principal ?? 0),
        0,
      ) * 100,
    ) / 100;
  const funded = overpaymentFundedByCapital(input, maximumOverpayment);
  const lumpSumOverpayment = strategy === "overpay" ? funded.overpayment : 0;
  const overpaymentCharge = strategy === "overpay" ? funded.charge : 0;
  const openingInvestment =
    strategy === "invest" ? input.availableCapital : funded.remainingCapital;
  const firstPaymentDate = input.mortgageTerms.firstPaymentDate;
  const terms: MortgageTerms = {
    ...input.mortgageTerms,
    overpayments: addDatedAmount(
      input.mortgageTerms.overpayments,
      firstPaymentDate,
      lumpSumOverpayment,
    ),
    fees: addDatedAmount(
      input.mortgageTerms.fees,
      firstPaymentDate,
      overpaymentCharge,
    ),
  };
  return {
    retainedSchedule,
    schedule: buildMortgageSchedule({
      openingBalance: input.openingMortgageBalance,
      initialAnnualRate: input.initialMortgageRate,
      rateChanges: input.rateChanges,
      terms,
    }),
    lumpSumOverpayment,
    overpaymentCharge,
    openingInvestment,
  };
}

function monthlyContribution(input: {
  strategy: MortgageInvestmentStrategy;
  month: number;
  monthlySurplus: number;
  mortgageDue: number;
  retainedMortgageDue: number;
  lumpSumOverpayment: number;
  overpaymentCharge: number;
}): number {
  const householdBudget =
    input.retainedMortgageDue + Math.max(input.monthlySurplus, 0);
  const capitalFundedAmount =
    input.strategy === "overpay" && input.month === 0
      ? input.lumpSumOverpayment + input.overpaymentCharge
      : 0;
  const mortgageDueFromMonthlyCash = Math.max(
    input.mortgageDue - capitalFundedAmount,
    0,
  );
  return Math.max(householdBudget - mortgageDueFromMonthlyCash, 0);
}

function simulateTimeline(input: {
  assumptions: MortgageInvestmentComparisonInput;
  strategy: MortgageInvestmentStrategy;
  setup: ScenarioSetup;
  netInvestmentReturn: number;
  stressedInvestmentReturn: number;
}): MortgageInvestmentPoint[] {
  const { assumptions, setup } = input;
  const rowsByDate = new Map(setup.schedule.map((row) => [row.date, row]));
  const retainedRowsByDate = new Map(
    setup.retainedSchedule.map((row) => [row.date, row]),
  );
  const start = parseISO(assumptions.mortgageTerms.firstPaymentDate);
  const netMonthlyReturn = monthlyRate(input.netInvestmentReturn);
  const stressedMonthlyReturn = monthlyRate(input.stressedInvestmentReturn);
  const propertyMonthlyReturn = monthlyRate(assumptions.propertyAnnualReturn);
  let investmentBalance = setup.openingInvestment;
  let stressedInvestmentBalance = setup.openingInvestment;
  let commonLiquidAssets = Math.max(assumptions.otherLiquidAssets, 0);
  let stressedCommonLiquidAssets = commonLiquidAssets;
  let propertyValue = Math.max(assumptions.propertyValue, 0);
  const timeline: MortgageInvestmentPoint[] = [];

  for (let month = 0; month < assumptions.horizonMonths; month++) {
    const date = format(addMonths(start, month), "yyyy-MM-dd");
    const row = rowsByDate.get(date);
    const retainedRow = retainedRowsByDate.get(date);
    const contribution = monthlyContribution({
      strategy: input.strategy,
      month,
      monthlySurplus: assumptions.monthlySurplus,
      mortgageDue: row?.totalDue ?? 0,
      retainedMortgageDue: retainedRow?.totalDue ?? 0,
      lumpSumOverpayment: setup.lumpSumOverpayment,
      overpaymentCharge: setup.overpaymentCharge,
    });
    investmentBalance =
      investmentBalance * (1 + netMonthlyReturn) + contribution;
    stressedInvestmentBalance =
      stressedInvestmentBalance * (1 + stressedMonthlyReturn) + contribution;
    commonLiquidAssets *= 1 + netMonthlyReturn;
    stressedCommonLiquidAssets *= 1 + stressedMonthlyReturn;
    propertyValue *= 1 + propertyMonthlyReturn;

    const mortgageBalance = row?.closingBalance ?? 0;
    const liquidAssets = commonLiquidAssets + investmentBalance;
    const stressedLiquidAssets =
      stressedCommonLiquidAssets + stressedInvestmentBalance;
    timeline.push({
      date,
      mortgageBalance: roundMoney(mortgageBalance),
      investmentBalance: roundMoney(investmentBalance),
      stressedInvestmentBalance: roundMoney(stressedInvestmentBalance),
      liquidAssets: roundMoney(liquidAssets),
      stressedLiquidAssets: roundMoney(stressedLiquidAssets),
      propertyValue: roundMoney(propertyValue),
      homeEquity: roundMoney(propertyValue - mortgageBalance),
      netWorth: roundMoney(
        assumptions.otherNetWorth +
          propertyValue -
          mortgageBalance +
          liquidAssets,
      ),
      stressedNetWorth: roundMoney(
        assumptions.otherNetWorth +
          propertyValue -
          mortgageBalance +
          stressedLiquidAssets,
      ),
    });
  }
  return timeline;
}

function outcomeFor(
  input: MortgageInvestmentComparisonInput,
  strategy: MortgageInvestmentStrategy,
  netInvestmentReturn: number,
  stressedInvestmentReturn: number,
): MortgageInvestmentOutcome {
  const setup = prepareScenario(input, strategy);
  const firstPaymentDate = input.mortgageTerms.firstPaymentDate;
  const fiTarget =
    input.withdrawalRate > 0
      ? input.annualSpendingAfterMortgage / input.withdrawalRate
      : Number.POSITIVE_INFINITY;
  const timeline = simulateTimeline({
    assumptions: input,
    strategy,
    setup,
    netInvestmentReturn,
    stressedInvestmentReturn,
  });
  const projectedFiDate =
    timeline.find((point) => point.liquidAssets >= fiTarget)?.date ?? null;
  const stressedProjectedFiDate =
    timeline.find((point) => point.stressedLiquidAssets >= fiTarget)?.date ??
    null;
  const rowsInHorizon = setup.schedule.slice(0, input.horizonMonths);
  const end = timeline.at(-1);
  const investment = end?.investmentBalance ?? setup.openingInvestment;
  const stressedInvestment =
    end?.stressedInvestmentBalance ?? setup.openingInvestment;
  return {
    strategy,
    label:
      strategy === "overpay" ? "Overpay mortgage" : "Retain debt and invest",
    lumpSumOverpayment: setup.lumpSumOverpayment,
    overpaymentCharge: setup.overpaymentCharge,
    mortgageBalance:
      end?.mortgageBalance ?? Math.abs(input.openingMortgageBalance),
    mortgagePayoffDate: setup.schedule.at(-1)?.date ?? firstPaymentDate,
    interestPaid: roundMoney(
      rowsInHorizon.reduce((sum, row) => sum + row.interest, 0),
    ),
    mortgageFeesAndCharges: roundMoney(
      rowsInHorizon.reduce((sum, row) => sum + row.fees, 0),
    ),
    firstYearMortgageCashRequired: roundMoney(
      setup.schedule.slice(0, 12).reduce((sum, row) => sum + row.totalDue, 0),
    ),
    investmentBalance: investment,
    stressedInvestmentBalance: stressedInvestment,
    liquidAssets:
      end?.liquidAssets ?? input.otherLiquidAssets + setup.openingInvestment,
    stressedLiquidAssets:
      end?.stressedLiquidAssets ??
      input.otherLiquidAssets + setup.openingInvestment,
    propertyValue: end?.propertyValue ?? input.propertyValue,
    homeEquity:
      end?.homeEquity ??
      input.propertyValue - Math.abs(input.openingMortgageBalance),
    netWorth:
      end?.netWorth ??
      input.otherNetWorth +
        input.propertyValue -
        Math.abs(input.openingMortgageBalance) +
        input.otherLiquidAssets +
        setup.openingInvestment,
    stressedNetWorth:
      end?.stressedNetWorth ??
      input.otherNetWorth +
        input.propertyValue -
        Math.abs(input.openingMortgageBalance) +
        input.otherLiquidAssets +
        setup.openingInvestment,
    drawdownExposure: roundMoney(investment - stressedInvestment),
    projectedFiDate,
    stressedProjectedFiDate,
    timeline,
  };
}

function compareAtReturn(
  input: MortgageInvestmentComparisonInput,
  investmentReturn: number,
): number {
  const netReturn = afterTaxAndFeesReturn(
    investmentReturn,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  const overpay = outcomeFor(input, "overpay", netReturn, netReturn);
  const invest = outcomeFor(input, "invest", netReturn, netReturn);
  return invest.netWorth - overpay.netWorth;
}

function findBreakEvenReturn(
  input: MortgageInvestmentComparisonInput,
): number | null {
  let low = -0.5;
  let high = 0.5;
  let lowDelta = compareAtReturn(input, low);
  const highDelta = compareAtReturn(input, high);
  if (lowDelta === 0) return low;
  if (highDelta === 0) return high;
  if (Math.sign(lowDelta) === Math.sign(highDelta)) return null;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    const delta = compareAtReturn(input, middle);
    if (Math.abs(delta) < 0.01) return middle;
    if (Math.sign(delta) === Math.sign(lowDelta)) {
      low = middle;
      lowDelta = delta;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

export function compareMortgageOverpaymentWithInvestment(
  input: MortgageInvestmentComparisonInput,
): MortgageInvestmentComparison {
  const netInvestmentReturn = afterTaxAndFeesReturn(
    input.investmentAnnualReturn,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  const stressedInvestmentReturn = afterTaxAndFeesReturn(
    input.investmentAnnualReturn -
      input.investmentVolatility * input.investmentStressMultiple,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  return {
    input,
    netInvestmentReturn,
    stressedInvestmentReturn,
    overpay: outcomeFor(
      input,
      "overpay",
      netInvestmentReturn,
      stressedInvestmentReturn,
    ),
    invest: outcomeFor(
      input,
      "invest",
      netInvestmentReturn,
      stressedInvestmentReturn,
    ),
    breakEvenInvestmentReturn: findBreakEvenReturn(input),
  };
}

export function buildMortgageInvestmentSensitivity(
  input: MortgageInvestmentComparisonInput,
  mortgageRates: readonly number[],
  investmentReturns: readonly number[],
): MortgageInvestmentSensitivity[] {
  return mortgageRates.flatMap((mortgageRate) =>
    investmentReturns.map((investmentReturn) => {
      const scenario = {
        ...input,
        initialMortgageRate: mortgageRate,
        rateChanges: [],
        investmentAnnualReturn: investmentReturn,
      };
      const netReturn = afterTaxAndFeesReturn(
        investmentReturn,
        input.investmentAnnualFeeRate,
        input.investmentTaxRate,
      );
      const overpay = outcomeFor(scenario, "overpay", netReturn, netReturn);
      const invest = outcomeFor(scenario, "invest", netReturn, netReturn);
      return {
        mortgageRate,
        investmentReturn,
        investNetWorthAdvantage: roundMoney(invest.netWorth - overpay.netWorth),
      };
    }),
  );
}
