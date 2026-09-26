import { addMonths, format, parseISO } from "date-fns";
import {
  type Account,
  accountLiquidity,
  effectiveExpectedReturn,
  isLiability,
} from "./account";
import { realRate } from "./assetTrackerAnalytics";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { PlannedExpenditure } from "./plannedExpenditure";
import {
  convertAccountAmountAtDate,
  convertMoneyAtDate,
  latestValuedBalances,
  valuationDates,
} from "./portfolioValuation";
import {
  monthlyAmount,
  monthlyFeeAmount,
  monthlyReceivedAmount,
  type RecurringFlow,
} from "./recurringFlow";

export const RUNWAY_FORECAST_MAX_YEARS = 30;

export type RunwayForecastPoint = {
  date: string;
  cashBalance: number;
  liquidBalance: number;
  totalBalance: number;
  cashMonths: number;
  liquidMonths: number;
  totalMonths: number;
  baselineCashMonths: number;
  baselineLiquidMonths: number;
  baselineTotalMonths: number;
};

type ProjectedAccount = {
  account: Account;
  balance: number;
};

type ForecastBalances = {
  cashBalance: number;
  liquidBalance: number;
  totalBalance: number;
};

function balancesByAccess(accounts: ProjectedAccount[]): ForecastBalances {
  let cashBalance = 0;
  let liquidBalance = 0;
  let totalBalance = 0;
  for (const projected of accounts) {
    const { account, balance } = projected;
    totalBalance += balance;
    if (isLiability(account.assetType)) continue;
    const liquidity = accountLiquidity(account);
    if (liquidity === "cash") cashBalance += balance;
    if (liquidity !== "illiquid") liquidBalance += balance;
  }
  return {
    cashBalance: Math.max(cashBalance, 0),
    liquidBalance: Math.max(liquidBalance, 0),
    totalBalance,
  };
}

function flowIsActive(flow: RecurringFlow, date: string): boolean {
  return (
    flow.startDate <= date && (flow.endDate == null || date <= flow.endDate)
  );
}

function applyExpectedFlow(
  byId: Map<string, ProjectedAccount>,
  flow: RecurringFlow,
  date: string,
): void {
  if (!flowIsActive(flow, date)) return;
  const source =
    flow.fromAccountId == null ? null : byId.get(flow.fromAccountId);
  const destination =
    flow.toAccountId == null ? null : byId.get(flow.toAccountId);

  if (flow.fromAccountId != null && source == null) return;
  if (flow.toAccountId != null && destination == null) return;

  // Historical spending already covers regular money leaving the portfolio.
  // External income still enters here, and owned-account transfers move the
  // appropriate liquidity pool without changing total net worth.
  if (source != null && destination == null) return;
  const amount = monthlyAmount(flow, destination?.balance);
  let receivedAmount =
    flow.conversion == null ? amount : monthlyReceivedAmount(flow);
  if (destination && isLiability(destination.account.assetType)) {
    receivedAmount = Math.min(
      receivedAmount,
      Math.max(-destination.balance, 0),
    );
  }
  if (amount <= 0) return;
  if (source) source.balance -= amount + monthlyFeeAmount(flow);
  if (destination) destination.balance += receivedAmount;
}

function applyExpectedFlows(
  accounts: ProjectedAccount[],
  flows: RecurringFlow[],
  date: string,
): void {
  const byId = new Map(
    accounts.map((projected) => [projected.account.id, projected]),
  );
  for (const flow of flows) {
    applyExpectedFlow(byId, flow, date);
  }
}

function applySpending(accounts: ProjectedAccount[], amount: number): void {
  const assets = accounts.filter(
    ({ account }) => !isLiability(account.assetType),
  );
  const ranked = assets.toSorted((a, b) => {
    const liquidityRank = (projected: ProjectedAccount) => {
      const liquidity = accountLiquidity(projected.account);
      if (liquidity === "cash") return 0;
      if (liquidity === "liquid") return 1;
      return 2;
    };
    return liquidityRank(a) - liquidityRank(b) || b.balance - a.balance;
  });
  let remaining = amount;
  for (const projected of ranked) {
    if (remaining <= 0) return;
    const available = Math.max(projected.balance, 0);
    const withdrawn = Math.min(available, remaining);
    projected.balance -= withdrawn;
    remaining -= withdrawn;
  }
  if (remaining > 0 && ranked[0]) ranked[0].balance -= remaining;
}

function compoundAccounts(
  accounts: ProjectedAccount[],
  inflation: number,
  date: string,
): void {
  for (const projected of accounts) {
    if (projected.balance < 0 && !isLiability(projected.account.assetType)) {
      continue;
    }
    const nominal = effectiveExpectedReturn(projected.account, date);
    const annualRealReturn = realRate(nominal, inflation);
    projected.balance *= (1 + annualRealReturn) ** (1 / 12);
  }
}

function applyPlannedExpenditures(
  accounts: ProjectedAccount[],
  expenditures: PlannedExpenditure[],
  afterDate: string,
  throughDate: string,
): void {
  const byId = new Map(
    accounts.map((projected) => [projected.account.id, projected]),
  );
  for (const expenditure of expenditures) {
    if (expenditure.date <= afterDate || expenditure.date > throughDate) {
      continue;
    }
    const source = byId.get(expenditure.fromAccountId);
    if (source) source.balance -= expenditure.amount;
  }
}

function convertProjectionFlow(
  repository: AssetTrackerRepository,
  flow: RecurringFlow,
  valuationDate: string,
): RecurringFlow | null {
  const amount =
    flow.amount == null
      ? undefined
      : convertMoneyAtDate(
          repository,
          { amount: flow.amount, currency: flow.currency },
          valuationDate,
        );
  const grossAmount =
    flow.grossAmount == null
      ? undefined
      : convertMoneyAtDate(
          repository,
          { amount: flow.grossAmount, currency: flow.currency },
          valuationDate,
        );
  const floor =
    flow.formula == null
      ? undefined
      : convertMoneyAtDate(
          repository,
          { amount: flow.formula.floor, currency: flow.currency },
          valuationDate,
        );
  const received =
    flow.conversion == null
      ? undefined
      : convertMoneyAtDate(repository, flow.conversion.received, valuationDate);
  const fee =
    flow.conversion?.fee == null
      ? undefined
      : convertMoneyAtDate(repository, flow.conversion.fee, valuationDate);
  if (
    amount === null ||
    grossAmount === null ||
    floor === null ||
    received === null ||
    fee === null
  ) {
    return null;
  }
  return {
    ...flow,
    currency: repository.settings.baseCurrency,
    ...(amount == null ? {} : { amount }),
    ...(grossAmount == null ? {} : { grossAmount }),
    ...(flow.formula == null
      ? {}
      : { formula: { ...flow.formula, floor: floor ?? 0 } }),
    ...(flow.conversion == null
      ? {}
      : {
          conversion: {
            ...flow.conversion,
            received: {
              amount: received ?? 0,
              currency: repository.settings.baseCurrency,
            },
            fee:
              fee == null
                ? undefined
                : {
                    amount: fee,
                    currency: repository.settings.baseCurrency,
                  },
          },
        }),
  };
}

function convertProjectionExpenditures(
  repository: AssetTrackerRepository,
  valuationDate: string,
): PlannedExpenditure[] | null {
  const converted: PlannedExpenditure[] = [];
  for (const expenditure of repository.plannedExpenditures) {
    const amount = convertAccountAmountAtDate(
      repository,
      expenditure.fromAccountId,
      expenditure.amount,
      valuationDate,
    );
    if (amount == null) return null;
    converted.push({ ...expenditure, amount });
  }
  return converted;
}

function projectBalances(input: {
  repository: AssetTrackerRepository;
  annualExpenditure: number;
  months: number;
  includePlannedExpenditures: boolean;
  startDate: string;
}): { date: string; balances: ForecastBalances }[] {
  const latest = latestValuedBalances(input.repository);
  if (latest == null) return [];
  const valuationDate = valuationDates(input.repository).at(-1);
  if (valuationDate == null) return [];
  const flows = input.repository.recurringFlows.map((flow) =>
    convertProjectionFlow(input.repository, flow, valuationDate),
  );
  if (flows.some((flow) => flow == null)) return [];
  const expenditures = convertProjectionExpenditures(
    input.repository,
    valuationDate,
  );
  if (expenditures == null) return [];
  const accounts = Array.from(input.repository.accounts.values())
    .filter((account) => account.closedAt == null)
    .map((account) => ({
      account,
      balance: latest.get(account.id) ?? 0,
    }));
  const points = [
    { date: input.startDate, balances: balancesByAccess(accounts) },
  ];
  const start = parseISO(input.startDate);
  let previousDate = input.startDate;
  for (let month = 1; month <= input.months; month++) {
    const date = format(addMonths(start, month), "yyyy-MM-dd");
    compoundAccounts(
      accounts,
      input.repository.settings.expectedAnnualInflation,
      date,
    );
    applyExpectedFlows(
      accounts,
      flows.filter((flow) => flow != null),
      date,
    );
    applySpending(accounts, input.annualExpenditure / 12);
    if (input.includePlannedExpenditures) {
      applyPlannedExpenditures(accounts, expenditures, previousDate, date);
    }
    points.push({ date, balances: balancesByAccess(accounts) });
    previousDate = date;
  }
  return points;
}

function monthsOfSpending(balance: number, annualCurrentExpenditure: number) {
  return Math.max((balance * 12) / annualCurrentExpenditure, 0);
}

export function buildRunwayForecast(input: {
  repository: AssetTrackerRepository;
  annualExpenditure: number | null;
  annualCurrentExpenditure: number | null;
  startDate: string;
  months?: number;
}): RunwayForecastPoint[] {
  if (
    input.annualExpenditure == null ||
    input.annualCurrentExpenditure == null ||
    input.annualCurrentExpenditure <= 0
  ) {
    return [];
  }
  const months = input.months ?? RUNWAY_FORECAST_MAX_YEARS * 12;
  const shared = {
    repository: input.repository,
    annualExpenditure: input.annualExpenditure,
    months,
    startDate: input.startDate,
  };
  const planned = projectBalances({
    ...shared,
    includePlannedExpenditures: true,
  });
  const baseline = projectBalances({
    ...shared,
    includePlannedExpenditures: false,
  });
  return planned.map((point, index) => {
    const withoutPlanned = baseline[index]?.balances ?? point.balances;
    return {
      date: point.date,
      ...point.balances,
      cashMonths: monthsOfSpending(
        point.balances.cashBalance,
        input.annualCurrentExpenditure as number,
      ),
      liquidMonths: monthsOfSpending(
        point.balances.liquidBalance,
        input.annualCurrentExpenditure as number,
      ),
      totalMonths: monthsOfSpending(
        point.balances.totalBalance,
        input.annualCurrentExpenditure as number,
      ),
      baselineCashMonths: monthsOfSpending(
        withoutPlanned.cashBalance,
        input.annualCurrentExpenditure as number,
      ),
      baselineLiquidMonths: monthsOfSpending(
        withoutPlanned.liquidBalance,
        input.annualCurrentExpenditure as number,
      ),
      baselineTotalMonths: monthsOfSpending(
        withoutPlanned.totalBalance,
        input.annualCurrentExpenditure as number,
      ),
    };
  });
}
