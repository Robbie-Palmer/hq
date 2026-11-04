import {
  addMonths,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import type { HousingValue } from "finance-housing-indices/browser";
import { isLiability } from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { PortfolioFinancialIndependence } from "./portfolioReconciliation";
import { latestValuedBalances } from "./portfolioValuation";

export type HousingValueRange = {
  lower: number;
  upper: number;
};

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
  homeValueRange?: HousingValueRange;
  propertyValueRanges?: Record<string, HousingValueRange>;
  mortgageBalance: number;
  homeEquity: number;
  homeEquityRange?: HousingValueRange;
  valuationBasis?: HousingValue[];
  annualNonHousingExpenditure: number;
  annualInvestableIncome: number;
  /** Mortgage interest and fees removed from the long-term spending basis. */
  annualMortgageExpenditureRemoved: number;
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
  fundingShortfall: boolean;
  totalNetWorth: number;
  withdrawalCapital: number;
  annualExpenditure: number;
  annualSavings: number;
  fiTarget: number;
  projectedFiDate: string | null;
  yearsToFi: number | null;
  timeline: HousingStrategyTimelinePhase[];
  valuationSensitivity: {
    homeEquity: HousingValueRange;
    totalNetWorth: HousingValueRange;
  };
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
    if (
      position.mortgageBalance > 0 &&
      position.mortgagePayoffDate != null &&
      position.mortgagePayoffDate > position.asOfDate
    ) {
      return [
        {
          startDate: position.asOfDate,
          endDate: position.mortgagePayoffDate,
          housingState: "Own current home with mortgage",
        },
        {
          startDate: position.mortgagePayoffDate,
          endDate: null,
          housingState: "Own current home after mortgage payoff",
        },
      ];
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
  const homeValueRange = position.homeValueRange ?? {
    lower: position.homeValue,
    upper: position.homeValue,
  };
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

  const fundingShortfall = releasedCapital < 0 || retainedEquity < 0;
  releasedCapital = Math.max(releasedCapital, 0);
  retainedEquity = Math.max(retainedEquity, 0);
  const annualExpenditure =
    position.annualNonHousingExpenditure +
    assumptions.annualRent +
    assumptions.annualOwnershipCost +
    assumptions.annualBorrowingCost;
  const annualSavings = position.annualInvestableIncome - annualExpenditure;
  const annualSavingsBeforeMove =
    position.annualInvestableIncome -
    position.annualNonHousingExpenditure -
    position.annualMortgageExpenditureRemoved;
  const moveMonthCount = monthsBetween(position.asOfDate, assumptions.moveDate);
  const capitalAtMove = projectCapital(
    position.withdrawalCapital,
    annualSavingsBeforeMove,
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
  const totalNetWorthAt = (homeValue: number) => {
    const positionNetWorth =
      position.totalNetWorth + homeValue - position.homeValue;
    if (assumptions.kind === "stay") return positionNetWorth;
    if (assumptions.kind === "equity-release") {
      return (
        positionNetWorth -
        assumptions.transactionCosts -
        assumptions.taxesAndFees
      );
    }
    return (
      positionNetWorth +
      assumptions.salePrice -
      homeValue +
      position.mortgageBalance -
      assumptions.mortgageSettlement -
      assumptions.transactionCosts -
      assumptions.taxesAndFees
    );
  };
  const retainedEquityAt = (homeValue: number) => {
    if (assumptions.kind === "stay") {
      return Math.max(homeValue - position.mortgageBalance, 0);
    }
    if (assumptions.kind === "equity-release") {
      return Math.max(
        homeValue - position.mortgageBalance - assumptions.equityReleaseAdvance,
        0,
      );
    }
    return retainedEquity;
  };

  return {
    ...assumptions,
    label: LABELS[assumptions.kind],
    releasedCapital,
    retainedEquity,
    fundingShortfall,
    totalNetWorth: position.totalNetWorth + netWorthAdjustment,
    withdrawalCapital,
    annualExpenditure,
    annualSavings,
    fiTarget,
    projectedFiDate: projection.date,
    yearsToFi: projection.years,
    timeline: timelineFor(position, assumptions),
    valuationSensitivity: {
      homeEquity: {
        lower: retainedEquityAt(homeValueRange.lower),
        upper: retainedEquityAt(homeValueRange.upper),
      },
      totalNetWorth: {
        lower: totalNetWorthAt(homeValueRange.lower),
        upper: totalNetWorthAt(homeValueRange.upper),
      },
    },
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

function selectedPropertyRange(
  repository: AssetTrackerRepository,
  accountId: string,
  balance: number,
): HousingValueRange {
  const selected = repository.selectedPropertyValues.get(accountId);
  if (selected?.uncertainty.kind !== "indicative-range") {
    return { lower: balance, upper: balance };
  }
  const scale = balance / selected.amount;
  return {
    lower: selected.uncertainty.lower * scale,
    upper: selected.uncertainty.upper * scale,
  };
}

function housingPositionTotals(
  repository: AssetTrackerRepository,
  balances: ReadonlyMap<string, number>,
) {
  const totals = {
    homeValue: 0,
    homeValueLower: 0,
    homeValueUpper: 0,
    propertyValueRanges: {} as Record<string, HousingValueRange>,
    mortgageBalance: 0,
    withdrawalCapital: 0,
  };
  for (const account of repository.accounts.values()) {
    if (account.closedAt != null) continue;
    const balance = balances.get(account.id) ?? 0;
    addAccountToHousingPosition(totals, account.assetType, balance);
    if (account.assetType !== "property") continue;
    const range = selectedPropertyRange(repository, account.id, balance);
    totals.propertyValueRanges[account.id] = range;
    totals.homeValueLower += range.lower;
    totals.homeValueUpper += range.upper;
  }
  return totals;
}

function mortgageExpenditureRemoved(
  financialIndependence: PortfolioFinancialIndependence,
): number {
  if (
    financialIndependence.annualExpenditureAfterMortgage == null ||
    financialIndependence.representativeAnnualExpenditure == null
  ) {
    return 0;
  }
  return Math.max(
    financialIndependence.representativeAnnualExpenditure -
      financialIndependence.annualExpenditureAfterMortgage,
    0,
  );
}

export function getHousingPlanningPosition(
  repository: AssetTrackerRepository,
  financialIndependence: PortfolioFinancialIndependence,
  asOfDate: string,
): HousingPlanningPosition | null {
  const balances = latestValuedBalances(repository);
  if (balances == null) return null;

  const totals = housingPositionTotals(repository, balances);
  if (totals.homeValue <= 0) return null;

  const annualNonHousingExpenditure =
    financialIndependence.annualExpenditureAfterMortgage ??
    financialIndependence.representativeAnnualExpenditure ??
    0;
  const annualSavings = financialIndependence.representativeAnnualSavings ?? 0;
  const annualMortgageExpenditureRemoved = mortgageExpenditureRemoved(
    financialIndependence,
  );
  const totalNetWorth = financialIndependence.runway.total.balance;

  return {
    asOfDate,
    totalNetWorth,
    withdrawalCapital: totals.withdrawalCapital,
    homeValue: totals.homeValue,
    homeValueRange: {
      lower: totals.homeValueLower,
      upper: totals.homeValueUpper,
    },
    propertyValueRanges: totals.propertyValueRanges,
    mortgageBalance: totals.mortgageBalance,
    homeEquity: totals.homeValue - totals.mortgageBalance,
    homeEquityRange: {
      lower: totals.homeValueLower - totals.mortgageBalance,
      upper: totals.homeValueUpper - totals.mortgageBalance,
    },
    valuationBasis: [...repository.selectedPropertyValues.values()],
    annualNonHousingExpenditure,
    annualInvestableIncome:
      annualNonHousingExpenditure +
      annualSavings +
      annualMortgageExpenditureRemoved,
    annualMortgageExpenditureRemoved,
    expectedRealReturn: financialIndependence.expectedRealReturn ?? 0,
    withdrawalRate: repository.settings.withdrawalRate,
    mortgagePayoffDate:
      financialIndependence.mortgageCashFlow?.payoffDate ?? null,
  };
}
