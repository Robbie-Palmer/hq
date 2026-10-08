import { addMonths, format, parseISO } from "date-fns";
import {
  type Account,
  accountLiquidity,
  effectiveExpectedReturn,
  isLiability,
} from "./account";
import { realRate } from "./assetTrackerAnalytics";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type {
  ForecastAmountRange,
  ForecastAssumption,
} from "./forecastAssumption";
import {
  type DecisionForecastSelection,
  type DecisionStage,
  type ForecastCashFlow,
  futureCashFlowForecastItems,
} from "./futureCashFlow";
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
  monthlyBreakdown: MonthlyForecastBreakdown;
};

export type RunwayScenarioPoint = RunwayForecastPoint & {
  accountBalances: Record<string, number>;
};

export type MonthlyForecastBreakdown = {
  baselineExpenditure: number;
  explicitIncomeChange: ForecastAmountRange;
  explicitExpenditureChange: ForecastAmountRange;
  externalIncome: number;
  accountTransfers: number;
  debtPayments: number;
  ordinaryRecurringOutflowsCoveredByBaseline: number;
  committedCashFlows: number;
  selectedDecisionCashFlows: number;
  possibleDecisions: ForecastAmountRange;
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

const ZERO_RANGE: ForecastAmountRange = {
  minimum: 0,
  expected: 0,
  maximum: 0,
};

function addRange(
  total: ForecastAmountRange,
  value: ForecastAmountRange,
): ForecastAmountRange {
  return {
    minimum: total.minimum + value.minimum,
    expected: total.expected + value.expected,
    maximum: total.maximum + value.maximum,
  };
}

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

function capLiabilityPayment(
  destination: ProjectedAccount | null,
  receivedAmount: number,
): number {
  if (destination == null || !isLiability(destination.account.assetType)) {
    return receivedAmount;
  }
  return Math.min(receivedAmount, Math.max(-destination.balance, 0));
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
    flow.toAccountId == null ? null : (byId.get(flow.toAccountId) ?? null);

  if (flow.fromAccountId != null && source == null) return;
  if (flow.toAccountId != null && destination == null) return;

  // Historical spending already covers regular money leaving the portfolio.
  // External income still enters here, and owned-account transfers move the
  // appropriate liquidity pool without changing total net worth.
  if (source != null && destination == null) return;
  const amount = monthlyAmount(flow, destination?.balance);
  const uncappedReceivedAmount =
    flow.conversion == null ? amount : monthlyReceivedAmount(flow);
  const receivedAmount = capLiabilityPayment(
    destination,
    uncappedReceivedAmount,
  );
  if (amount <= 0 || uncappedReceivedAmount <= 0) return;
  const receivedRatio = receivedAmount / uncappedReceivedAmount;
  if (source) {
    source.balance -= (amount + monthlyFeeAmount(flow)) * receivedRatio;
  }
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

function applyFutureCashFlows(
  accounts: ProjectedAccount[],
  cashFlows: ForecastCashFlow[],
  afterDate: string,
  throughDate: string,
): void {
  const byId = new Map(
    accounts.map((projected) => [projected.account.id, projected]),
  );
  for (const cashFlow of cashFlows) {
    if (cashFlow.date <= afterDate || cashFlow.date > throughDate) {
      continue;
    }
    const source = byId.get(cashFlow.fromAccountId);
    if (source) source.balance -= cashFlow.amount;
  }
}

function applyIncomeAssumptions(
  accounts: ProjectedAccount[],
  assumptions: readonly ForecastAssumption[],
): void {
  const byId = new Map(
    accounts.map((projected) => [projected.account.id, projected]),
  );
  for (const assumption of assumptions) {
    if (assumption.kind !== "income" || assumption.accountId == null) continue;
    const destination = byId.get(assumption.accountId);
    if (destination != null) {
      destination.balance += assumption.monthlyChange.expected;
    }
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

function convertProjectionCashFlows(
  repository: AssetTrackerRepository,
  valuationDate: string,
  decisionSelection?: DecisionForecastSelection,
): ForecastCashFlow[] | null {
  const converted: ForecastCashFlow[] = [];
  for (const cashFlow of futureCashFlowForecastItems(
    repository.futureCashFlows,
    decisionSelection,
  )) {
    const amount = convertAccountAmountAtDate(
      repository,
      cashFlow.fromAccountId,
      cashFlow.amount,
      valuationDate,
    );
    if (amount == null) return null;
    converted.push({
      ...cashFlow,
      amount,
      currency: repository.settings.baseCurrency,
    });
  }
  return converted;
}

function convertForecastAssumptions(
  repository: AssetTrackerRepository,
  valuationDate: string,
): ForecastAssumption[] | null {
  const converted: ForecastAssumption[] = [];
  for (const assumption of repository.forecastAssumptionSets.flatMap(
    ({ assumptions }) => assumptions,
  )) {
    const values = [
      assumption.monthlyChange.minimum,
      assumption.monthlyChange.expected,
      assumption.monthlyChange.maximum,
    ].map((amount) =>
      convertMoneyAtDate(
        repository,
        { amount, currency: assumption.currency },
        valuationDate,
      ),
    );
    if (values.some((value) => value == null)) return null;
    const [minimum, expected, maximum] = values;
    if (minimum == null || expected == null || maximum == null) return null;
    converted.push({
      ...assumption,
      currency: repository.settings.baseCurrency,
      monthlyChange: { minimum, expected, maximum },
    });
  }
  return converted;
}

function activeFlows(flows: readonly RecurringFlow[], date: string) {
  return flows.filter((flow) => flowIsActive(flow, date));
}

function recurringFlowBreakdown(
  repository: AssetTrackerRepository,
  flows: readonly RecurringFlow[],
  date: string,
) {
  let externalIncome = 0;
  let accountTransfers = 0;
  let debtPayments = 0;
  let ordinaryRecurringOutflowsCoveredByBaseline = 0;
  for (const flow of activeFlows(flows, date)) {
    const amount = monthlyAmount(flow);
    if (flow.fromAccountId == null) externalIncome += amount;
    if (flow.fromAccountId != null && flow.toAccountId == null) {
      ordinaryRecurringOutflowsCoveredByBaseline += amount;
    }
    if (flow.fromAccountId != null && flow.toAccountId != null) {
      const destination = repository.accounts.get(flow.toAccountId);
      if (destination != null && isLiability(destination.assetType)) {
        debtPayments += amount;
      } else {
        accountTransfers += amount;
      }
    }
  }
  return {
    externalIncome,
    accountTransfers,
    debtPayments,
    ordinaryRecurringOutflowsCoveredByBaseline,
  };
}

function selectedCashFlowBreakdown(
  cashFlows: readonly ForecastCashFlow[],
  afterDate: string,
  throughDate: string,
) {
  let committedCashFlows = 0;
  let selectedDecisionCashFlows = 0;
  for (const cashFlow of cashFlows) {
    if (cashFlow.date <= afterDate || cashFlow.date > throughDate) continue;
    if (cashFlow.kind === "commitment") committedCashFlows += cashFlow.amount;
    else selectedDecisionCashFlows += cashFlow.amount;
  }
  return { committedCashFlows, selectedDecisionCashFlows };
}

function convertDecisionStageRange(
  repository: AssetTrackerRepository,
  stage: DecisionStage,
  valuationDate: string,
): ForecastAmountRange | null {
  const minimum = convertAccountAmountAtDate(
    repository,
    stage.fromAccountId,
    stage.minimumAmount,
    valuationDate,
  );
  const expected = convertAccountAmountAtDate(
    repository,
    stage.fromAccountId,
    stage.expectedAmount,
    valuationDate,
  );
  const maximum = convertAccountAmountAtDate(
    repository,
    stage.fromAccountId,
    stage.maximumAmount,
    valuationDate,
  );
  return minimum == null || expected == null || maximum == null
    ? null
    : { minimum, expected, maximum };
}

function possibleDecisionBreakdown(
  repository: AssetTrackerRepository,
  afterDate: string,
  throughDate: string,
  valuationDate: string,
): ForecastAmountRange {
  let possibleDecisions = ZERO_RANGE;
  for (const record of repository.futureCashFlows) {
    if (record.kind !== "decision" || record.status !== "considering") continue;
    for (const stage of record.stages) {
      if (stage.expectedDate <= afterDate || stage.expectedDate > throughDate) {
        continue;
      }
      const range = convertDecisionStageRange(repository, stage, valuationDate);
      if (range != null) possibleDecisions = addRange(possibleDecisions, range);
    }
  }
  return possibleDecisions;
}

function futureCashFlowBreakdown(
  repository: AssetTrackerRepository,
  cashFlows: readonly ForecastCashFlow[],
  afterDate: string,
  throughDate: string,
  valuationDate: string,
) {
  return {
    ...selectedCashFlowBreakdown(cashFlows, afterDate, throughDate),
    possibleDecisions: possibleDecisionBreakdown(
      repository,
      afterDate,
      throughDate,
      valuationDate,
    ),
  };
}

function assumptionBreakdown(
  assumptions: readonly ForecastAssumption[],
): Pick<
  MonthlyForecastBreakdown,
  "explicitIncomeChange" | "explicitExpenditureChange"
> {
  let explicitIncomeChange = ZERO_RANGE;
  let explicitExpenditureChange = ZERO_RANGE;
  for (const assumption of assumptions) {
    if (assumption.kind === "income") {
      explicitIncomeChange = addRange(
        explicitIncomeChange,
        assumption.monthlyChange,
      );
    } else {
      explicitExpenditureChange = addRange(
        explicitExpenditureChange,
        assumption.monthlyChange,
      );
    }
  }
  return { explicitIncomeChange, explicitExpenditureChange };
}

function projectBalances(input: {
  repository: AssetTrackerRepository;
  annualExpenditure: number;
  months: number;
  includePlannedExpenditures: boolean;
  startDate: string;
  decisionSelection?: DecisionForecastSelection;
}): Array<{
  date: string;
  balances: ForecastBalances;
  accountBalances: Record<string, number>;
  monthlyBreakdown: MonthlyForecastBreakdown;
}> {
  const latest = latestValuedBalances(input.repository);
  if (latest == null) return [];
  const valuationDate = valuationDates(input.repository).at(-1);
  if (valuationDate == null) return [];
  const flows = input.repository.recurringFlows.map((flow) =>
    convertProjectionFlow(input.repository, flow, valuationDate),
  );
  if (flows.some((flow) => flow == null)) return [];
  const cashFlows = convertProjectionCashFlows(
    input.repository,
    valuationDate,
    input.decisionSelection,
  );
  if (cashFlows == null) return [];
  const assumptions = convertForecastAssumptions(
    input.repository,
    valuationDate,
  );
  if (assumptions == null) return [];
  const accounts = Array.from(input.repository.accounts.values())
    .filter((account) => account.closedAt == null)
    .map((account) => ({
      account,
      balance: latest.get(account.id) ?? 0,
    }));
  const points = [
    {
      date: input.startDate,
      balances: balancesByAccess(accounts),
      accountBalances: Object.fromEntries(
        accounts.map(({ account, balance }) => [account.id, balance]),
      ),
      monthlyBreakdown: {
        baselineExpenditure: 0,
        explicitIncomeChange: ZERO_RANGE,
        explicitExpenditureChange: ZERO_RANGE,
        externalIncome: 0,
        accountTransfers: 0,
        debtPayments: 0,
        ordinaryRecurringOutflowsCoveredByBaseline: 0,
        committedCashFlows: 0,
        selectedDecisionCashFlows: 0,
        possibleDecisions: ZERO_RANGE,
      },
    },
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
    const activeSetAssumptionIds = new Set(
      input.repository.forecastAssumptionSets
        .filter(({ status }) => status === "active")
        .flatMap(({ assumptions: setAssumptions }) =>
          setAssumptions.map(({ id }) => id),
        ),
    );
    const activeAssumptions = assumptions.filter(
      (assumption) =>
        activeSetAssumptionIds.has(assumption.id) &&
        assumption.startDate <= date &&
        (assumption.endDate == null || assumption.endDate > previousDate),
    );
    applyIncomeAssumptions(accounts, activeAssumptions);
    const changes = assumptionBreakdown(activeAssumptions);
    const baselineExpenditure = input.annualExpenditure / 12;
    applySpending(
      accounts,
      Math.max(
        baselineExpenditure + changes.explicitExpenditureChange.expected,
        0,
      ),
    );
    if (input.includePlannedExpenditures) {
      applyFutureCashFlows(accounts, cashFlows, previousDate, date);
    }
    points.push({
      date,
      balances: balancesByAccess(accounts),
      accountBalances: Object.fromEntries(
        accounts.map(({ account, balance }) => [account.id, balance]),
      ),
      monthlyBreakdown: {
        baselineExpenditure,
        ...changes,
        ...recurringFlowBreakdown(
          input.repository,
          flows.filter((flow) => flow != null),
          date,
        ),
        ...futureCashFlowBreakdown(
          input.repository,
          input.includePlannedExpenditures ? cashFlows : [],
          previousDate,
          date,
          valuationDate,
        ),
      },
    });
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
      monthlyBreakdown: point.monthlyBreakdown,
    };
  });
}

export function buildRunwayScenarioProjection(input: {
  repository: AssetTrackerRepository;
  annualExpenditure: number | null;
  annualCurrentExpenditure: number | null;
  startDate: string;
  months: number;
  decisionSelection: DecisionForecastSelection;
}): RunwayScenarioPoint[] {
  if (
    input.annualExpenditure == null ||
    input.annualCurrentExpenditure == null ||
    input.annualCurrentExpenditure <= 0
  ) {
    return [];
  }
  return projectBalances({
    repository: input.repository,
    annualExpenditure: input.annualExpenditure,
    months: input.months,
    startDate: input.startDate,
    includePlannedExpenditures: true,
    decisionSelection: input.decisionSelection,
  }).map((point) => ({
    date: point.date,
    ...point.balances,
    accountBalances: point.accountBalances,
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
    baselineCashMonths: 0,
    baselineLiquidMonths: 0,
    baselineTotalMonths: 0,
    monthlyBreakdown: point.monthlyBreakdown,
  }));
}
