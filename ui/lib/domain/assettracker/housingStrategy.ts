import {
  addMonths,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import { isLiability } from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { PortfolioFinancialIndependence } from "./portfolioReconciliation";
import { latestValuedBalances } from "./portfolioValuation";

export type HousingStrategyKind =
  | "stay"
  | "sell-and-rent"
  | "downsize"
  | "equity-release";

export type HousingPlanningPosition = {
  asOfDate: string;
  totalNetWorth: number;
  withdrawalCapital: number;
  homeValue: number;
  mortgageBalance: number;
  homeEquity: number;
  annualNonHousingExpenditure: number;
  annualInvestableIncome: number;
  expectedRealReturn: number;
  withdrawalRate: number;
  mortgagePayoffDate: string | null;
};

export type HousingStrategyAssumptions = {
  kind: HousingStrategyKind;
  moveDate: string;
  salePrice: number;
  mortgageSettlement: number;
  transactionCosts: number;
  taxesAndFees: number;
  replacementHousingCost: number;
  annualRent: number;
  annualOwnershipCost: number;
  annualBorrowingCost: number;
  equityReleaseAdvance: number;
};

export type HousingStrategyTimelinePhase = {
  startDate: string;
  /** Exclusive boundary. The next phase starts on this date. */
  endDate: string | null;
  housingState: string;
};

export type HousingStrategyOutcome = HousingStrategyAssumptions & {
  label: string;
  releasedCapital: number;
  retainedEquity: number;
  totalNetWorth: number;
  withdrawalCapital: number;
  annualExpenditure: number;
  annualSavings: number;
  fiTarget: number;
  projectedFiDate: string | null;
  yearsToFi: number | null;
  timeline: HousingStrategyTimelinePhase[];
};

const LABELS: Record<HousingStrategyKind, string> = {
  stay: "Stay",
  "sell-and-rent": "Sell and rent",
  downsize: "Downsize",
  "equity-release": "Equity release",
};

function monthsBetween(startDate: string, endDate: string): number {
  return Math.max(
    0,
    differenceInCalendarMonths(parseISO(endDate), parseISO(startDate)),
  );
}

function projectCapital(
  openingCapital: number,
  annualSavings: number,
  annualReturn: number,
  months: number,
): number {
  const monthlyReturn = (1 + annualReturn) ** (1 / 12) - 1;
  let capital = openingCapital;
  for (let month = 0; month < months; month++) {
    capital = capital * (1 + monthlyReturn) + annualSavings / 12;
  }
  return capital;
}

function projectedFiDate(input: {
  startDate: string;
  openingCapital: number;
  target: number;
  annualSavings: number;
  annualReturn: number;
}): { date: string | null; years: number | null } {
  if (input.openingCapital >= input.target) {
    return { date: input.startDate, years: 0 };
  }
  let capital = input.openingCapital;
  const monthlyReturn = (1 + input.annualReturn) ** (1 / 12) - 1;
  for (let month = 1; month <= 1_200; month++) {
    capital = capital * (1 + monthlyReturn) + input.annualSavings / 12;
    if (capital >= input.target) {
      return {
        date: format(addMonths(parseISO(input.startDate), month), "yyyy-MM-dd"),
        years: month / 12,
      };
    }
  }
  return { date: null, years: null };
}

function timelineFor(
  position: HousingPlanningPosition,
  assumptions: HousingStrategyAssumptions,
): HousingStrategyTimelinePhase[] {
  if (assumptions.kind === "stay") {
    const phases: HousingStrategyTimelinePhase[] = [];
    if (
      position.mortgageBalance > 0 &&
      position.mortgagePayoffDate != null &&
      position.mortgagePayoffDate > position.asOfDate
    ) {
      phases.push({
        startDate: position.asOfDate,
        endDate: position.mortgagePayoffDate,
        housingState: "Own current home with mortgage",
      });
      phases.push({
        startDate: position.mortgagePayoffDate,
        endDate: null,
        housingState: "Own current home after mortgage payoff",
      });
      return phases;
    }
    return [
      {
        startDate: position.asOfDate,
        endDate: null,
        housingState: "Own current home",
      },
    ];
  }

  const beforeMove = {
    startDate: position.asOfDate,
    endDate: assumptions.moveDate,
    housingState: "Own current home until the move completes",
  };
  const afterMove: Record<Exclude<HousingStrategyKind, "stay">, string> = {
    "sell-and-rent": "Rent after sale and mortgage settlement",
    downsize: "Own replacement home after sale and mortgage settlement",
    "equity-release": "Own current home with equity-release borrowing",
  };
  const afterMovePhase = {
    startDate: assumptions.moveDate,
    endDate: null,
    housingState: afterMove[assumptions.kind],
  };
  return assumptions.moveDate <= position.asOfDate
    ? [afterMovePhase]
    : [beforeMove, afterMovePhase];
}

export function compareHousingStrategy(
  position: HousingPlanningPosition,
  assumptions: HousingStrategyAssumptions,
): HousingStrategyOutcome {
  const saleNet =
    assumptions.salePrice -
    assumptions.mortgageSettlement -
    assumptions.transactionCosts -
    assumptions.taxesAndFees;
  let releasedCapital = 0;
  let retainedEquity = position.homeEquity;
  let netWorthAdjustment = 0;

  switch (assumptions.kind) {
    case "sell-and-rent":
      releasedCapital = saleNet;
      retainedEquity = 0;
      netWorthAdjustment =
        assumptions.salePrice -
        position.homeValue +
        position.mortgageBalance -
        assumptions.mortgageSettlement -
        assumptions.transactionCosts -
        assumptions.taxesAndFees;
      break;
    case "downsize":
      releasedCapital = saleNet - assumptions.replacementHousingCost;
      retainedEquity = assumptions.replacementHousingCost;
      netWorthAdjustment =
        assumptions.salePrice -
        position.homeValue +
        position.mortgageBalance -
        assumptions.mortgageSettlement -
        assumptions.transactionCosts -
        assumptions.taxesAndFees;
      break;
    case "equity-release":
      releasedCapital =
        assumptions.equityReleaseAdvance -
        assumptions.transactionCosts -
        assumptions.taxesAndFees;
      retainedEquity = position.homeEquity - assumptions.equityReleaseAdvance;
      netWorthAdjustment =
        -assumptions.transactionCosts - assumptions.taxesAndFees;
      break;
    case "stay":
      break;
  }

  releasedCapital = Math.max(releasedCapital, 0);
  retainedEquity = Math.max(retainedEquity, 0);
  const annualExpenditure =
    position.annualNonHousingExpenditure +
    assumptions.annualRent +
    assumptions.annualOwnershipCost +
    assumptions.annualBorrowingCost;
  const annualSavings = position.annualInvestableIncome - annualExpenditure;
  const moveMonthCount = monthsBetween(position.asOfDate, assumptions.moveDate);
  const capitalAtMove = projectCapital(
    position.withdrawalCapital,
    position.annualInvestableIncome - position.annualNonHousingExpenditure,
    position.expectedRealReturn,
    moveMonthCount,
  );
  const withdrawalCapital = capitalAtMove + releasedCapital;
  const fiTarget = annualExpenditure / position.withdrawalRate;
  const projection = projectedFiDate({
    startDate: assumptions.moveDate,
    openingCapital: withdrawalCapital,
    target: fiTarget,
    annualSavings,
    annualReturn: position.expectedRealReturn,
  });

  return {
    ...assumptions,
    label: LABELS[assumptions.kind],
    releasedCapital,
    retainedEquity,
    totalNetWorth: position.totalNetWorth + netWorthAdjustment,
    withdrawalCapital,
    annualExpenditure,
    annualSavings,
    fiTarget,
    projectedFiDate: projection.date,
    yearsToFi: projection.years,
    timeline: timelineFor(position, assumptions),
  };
}

function addAccountToHousingPosition(
  totals: Pick<
    HousingPlanningPosition,
    "homeValue" | "mortgageBalance" | "withdrawalCapital"
  >,
  assetType: Parameters<typeof isLiability>[0],
  balance: number,
): void {
  if (assetType === "property") {
    totals.homeValue += Math.max(balance, 0);
    return;
  }
  if (assetType === "mortgage") {
    totals.mortgageBalance += Math.max(-balance, 0);
    return;
  }
  totals.withdrawalCapital += isLiability(assetType)
    ? balance
    : Math.max(balance, 0);
}

export function getHousingPlanningPosition(
  repository: AssetTrackerRepository,
  financialIndependence: PortfolioFinancialIndependence,
  asOfDate: string,
): HousingPlanningPosition | null {
  const balances = latestValuedBalances(repository);
  if (balances == null) return null;

  const totals = {
    homeValue: 0,
    mortgageBalance: 0,
    withdrawalCapital: 0,
  };
  for (const account of repository.accounts.values()) {
    if (account.closedAt != null) continue;
    const balance = balances.get(account.id) ?? 0;
    addAccountToHousingPosition(totals, account.assetType, balance);
  }
  if (totals.homeValue <= 0) return null;

  const annualNonHousingExpenditure =
    financialIndependence.annualExpenditureAfterMortgage ??
    financialIndependence.representativeAnnualExpenditure ??
    0;
  const annualSavings = financialIndependence.representativeAnnualSavings ?? 0;
  const totalNetWorth = financialIndependence.runway.total.balance;

  return {
    asOfDate,
    totalNetWorth,
    withdrawalCapital: totals.withdrawalCapital,
    homeValue: totals.homeValue,
    mortgageBalance: totals.mortgageBalance,
    homeEquity: totals.homeValue - totals.mortgageBalance,
    annualNonHousingExpenditure,
    annualInvestableIncome: annualNonHousingExpenditure + annualSavings,
    expectedRealReturn: financialIndependence.expectedRealReturn ?? 0,
    withdrawalRate: repository.settings.withdrawalRate,
    mortgagePayoffDate:
      financialIndependence.mortgageCashFlow?.payoffDate ?? null,
  };
}
