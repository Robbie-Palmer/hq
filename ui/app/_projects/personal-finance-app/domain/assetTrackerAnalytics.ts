import { addMonths, format, parseISO } from "date-fns";
import {
  type Account,
  type AccountId,
  effectiveExpectedReturn,
} from "./account";
import type { BalanceSnapshotView } from "./assetTrackerViews";
import { monthlyAmount, type RecurringFlow } from "./recurringFlow";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

type ReturnSchedule = Pick<
  Account,
  "expectedAnnualReturn" | "expectedReturnChanges"
>;

function yearsBetween(fromDate: string, toDate: string): number {
  return (
    (new Date(toDate).getTime() - new Date(fromDate).getTime()) / MS_PER_YEAR
  );
}

/**
 * Compound annual growth rate from the first positive balance to the latest
 * snapshot. Returns null when there is no meaningful growth period (fewer
 * than two snapshots, no positive starting balance, or zero elapsed time).
 *
 * Note: this is money-weighted — contributions count as growth. Prefer
 * computeMoneyWeightedReturn when transfer records are available.
 */
export function computeCagr(snapshots: BalanceSnapshotView[]): number | null {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted.find((s) => s.balance > 0);
  const end = sorted.at(-1);
  if (!start || !end) return null;
  const years = yearsBetween(start.date, end.date);
  if (years <= 0) return null;
  const ratio = end.balance / start.balance;
  // A negative end balance gives a negative ratio, and a fractional power of a
  // negative number is NaN — guard so it never leaks into charts/formatting.
  // A zero ratio is fine: it yields a clean -100% (total loss).
  if (ratio < 0) return null;
  const cagr = ratio ** (1 / years) - 1;
  return Number.isFinite(cagr) ? cagr : null;
}

/** Money in (+) or out (-) of an account on a date, e.g. a recorded transfer */
export type ExternalFlow = {
  date: string;
  amount: number;
};

/**
 * Annualised growth rate excluding contributions: the internal rate of
 * return that grows the starting balance, plus each recorded in/out flow
 * from its own date, into the final balance. Falls back to the plain CAGR
 * when no flows are recorded in the period (the two are then identical).
 *
 * Only flows the tracker knows about (recorded transfers) can be excluded —
 * balance jumps from unrecorded contributions still read as growth.
 */
export function computeMoneyWeightedReturn(
  snapshots: BalanceSnapshotView[],
  flows: ExternalFlow[],
): number | null {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted.find((s) => s.balance > 0);
  const end = sorted.at(-1);
  if (!start || !end) return null;
  const years = yearsBetween(start.date, end.date);
  if (years <= 0) return null;

  const periodFlows = flows.filter(
    (flow) => flow.date > start.date && flow.date <= end.date,
  );
  if (periodFlows.length === 0) return computeCagr(snapshots);

  // Solve start*(1+r)^T + sum(flow*(1+r)^(T-t)) = end for r by bisection
  const value = (rate: number): number => {
    let total = start.balance * (1 + rate) ** years;
    for (const flow of periodFlows) {
      total += flow.amount * (1 + rate) ** yearsBetween(flow.date, end.date);
    }
    return total - end.balance;
  };

  let low = -0.9999;
  let high = 10;
  if (value(low) > 0 || value(high) < 0) return null; // no root in range
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (value(mid) > 0) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return (low + high) / 2;
}

/** The real (inflation-adjusted) equivalent of a nominal annual rate */
export function realRate(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

/**
 * Converts a past nominal amount into money-of-`toDate` using expected
 * inflation — e.g. a 2020 net worth restated in today's purchasing power.
 */
export function inflateToPresent(
  value: number,
  fromDate: string,
  toDate: string,
  inflation: number,
): number {
  return value * (1 + inflation) ** Math.max(yearsBetween(fromDate, toDate), 0);
}

export type TrajectoryPoint = {
  date: string;
  actual: number;
  expected: number;
};

export type AccountHistoryPoint = {
  date: string;
  actual?: number;
  expected?: number;
  /** Cumulative external capital paid into the account, net of withdrawals. */
  contributed?: number;
};

export type BalanceEstimatePoint = {
  date: string;
  /** Confirmed balance on this exact date, when one was recorded. */
  actual?: number;
  /** Best balance for totals: confirmed on valuation dates, estimated otherwise. */
  estimated: number;
  /** Estimate immediately before a confirmed balance resets the projection. */
  expected: number;
};

/**
 * Compounds `principal` from `fromDate` to `toDate`, splitting the span at any
 * scheduled rate-change boundaries so a change mid-interval is applied from
 * its effective date rather than the rate at the interval start.
 */
function compoundAcrossSchedule(
  schedule: ReturnSchedule,
  principal: number,
  fromDate: string,
  toDate: string,
): number {
  const boundaries = (schedule.expectedReturnChanges ?? [])
    .map((change) => change.date)
    .filter((date) => date > fromDate && date < toDate)
    .sort((a, b) => a.localeCompare(b));
  let value = principal;
  let cursor = fromDate;
  for (const boundary of [...boundaries, toDate]) {
    const rate = effectiveExpectedReturn(schedule, cursor);
    value *= (1 + rate) ** Math.max(yearsBetween(cursor, boundary), 0);
    cursor = boundary;
  }
  return value;
}

function projectBalanceEstimate(
  schedule: ReturnSchedule,
  estimate: number | null,
  previousDate: string | null,
  date: string,
  flowAmount: number,
  actual: number | undefined,
): { expected: number | null; nextEstimate: number | null } {
  const hadEstimate = estimate != null;
  let projected = estimate;
  if (projected != null && previousDate != null) {
    projected = compoundAcrossSchedule(schedule, projected, previousDate, date);
  }
  if (projected == null && flowAmount !== 0) projected = 0;
  if (projected != null && (actual == null || hadEstimate)) {
    projected += flowAmount;
  }

  // The first confirmed valuation is the anchor. Later valuations retain
  // the pre-reset expectation so the chart can show the estimation error.
  const expected =
    actual != null && !hadEstimate ? actual : (projected ?? actual);
  return { expected: expected ?? null, nextEstimate: actual ?? projected };
}

/**
 * Estimates balances between confirmed valuations. Each confirmed balance
 * resets the estimate. Between them, dated capital flows are applied and the
 * running balance compounds at the expected return.
 *
 * `sampleDates` lets portfolio charts request estimates on their shared date
 * grid without turning those estimates into stored market valuations.
 */
export function buildBalanceEstimateSeries(
  schedule: ReturnSchedule,
  snapshots: BalanceSnapshotView[],
  flows: ExternalFlow[] = [],
  sampleDates: string[] = [],
): BalanceEstimatePoint[] {
  const snapshotByDate = new Map(
    snapshots.map((snapshot) => [snapshot.date, snapshot.balance]),
  );
  const flowsByDate = new Map<string, number>();
  for (const flow of flows) {
    flowsByDate.set(flow.date, (flowsByDate.get(flow.date) ?? 0) + flow.amount);
  }
  const dates = Array.from(
    new Set([...snapshotByDate.keys(), ...flowsByDate.keys(), ...sampleDates]),
  ).sort((a, b) => a.localeCompare(b));

  const points: BalanceEstimatePoint[] = [];
  let estimate: number | null = null;
  let previousDate: string | null = null;

  for (const date of dates) {
    const actual = snapshotByDate.get(date);
    const flowAmount = flowsByDate.get(date) ?? 0;
    const projected = projectBalanceEstimate(
      schedule,
      estimate,
      previousDate,
      date,
      flowAmount,
      actual,
    );
    const expected = projected.expected;
    if (expected != null) {
      points.push({
        date,
        ...(actual == null ? {} : { actual }),
        estimated: Math.round((actual ?? expected) * 100) / 100,
        expected: Math.round(expected * 100) / 100,
      });
    }

    estimate = projected.nextEstimate;
    if (estimate != null) previousDate = date;
  }

  return points;
}

/**
 * Expected-vs-actual series for forecast reconciliation. The expected curve
 * is anchored to the first recorded balance, compounds at the expected
 * annual return (honouring scheduled rate changes), and steps at each
 * recorded transfer in/out — so contributions and withdrawals move the
 * expected line without counting as performance. It is never re-anchored to
 * later actuals, so the remaining gap between the lines is pure over- or
 * under-performance against expectation.
 */
export function buildExpectedTrajectory(
  schedule: ReturnSchedule,
  snapshots: BalanceSnapshotView[],
  flows: ExternalFlow[] = [],
): TrajectoryPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  let expected = sorted[0]?.balance ?? 0;
  let previousDate = sorted[0]?.date ?? "";
  return sorted.map((snapshot, i) => {
    if (i > 0) {
      // Compound the running expectation across the interval...
      expected = compoundAcrossSchedule(
        schedule,
        expected,
        previousDate,
        snapshot.date,
      );
      // ...then add contributions/withdrawals recorded within it, each grown
      // from its own date (a contribution isn't growth, but it earns after)
      for (const flow of flows) {
        if (flow.date > previousDate && flow.date <= snapshot.date) {
          expected += compoundAcrossSchedule(
            schedule,
            flow.amount,
            flow.date,
            snapshot.date,
          );
        }
      }
      previousDate = snapshot.date;
    }
    return {
      date: snapshot.date,
      actual: snapshot.balance,
      expected: Math.round(expected * 100) / 100,
    };
  });
}

/**
 * Adds an exact cumulative-capital series to the sparse actual/expected
 * trajectory. Capital-flow dates remain visible even where no market-value
 * snapshot exists; missing actual values stay missing rather than being
 * fabricated from contribution history.
 */
export function buildAccountHistorySeries(
  schedule: ReturnSchedule,
  snapshots: BalanceSnapshotView[],
  flows: ExternalFlow[] = [],
  sampleDates: string[] = [],
): AccountHistoryPoint[] {
  const estimateByDate = new Map(
    buildBalanceEstimateSeries(schedule, snapshots, flows, sampleDates).map(
      (point) => [point.date, point],
    ),
  );
  const sortedFlows = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const dates = Array.from(
    new Set([
      ...estimateByDate.keys(),
      ...sortedFlows.map((flow) => flow.date),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  let flowIndex = 0;
  let contributed = 0;
  let hasContributionHistory = false;
  return dates.map((date) => {
    let flow = sortedFlows[flowIndex];
    while (flow && flow.date <= date) {
      contributed += flow.amount;
      flowIndex++;
      hasContributionHistory = true;
      flow = sortedFlows[flowIndex];
    }
    const estimate = estimateByDate.get(date);
    return {
      date,
      ...(estimate?.actual == null ? {} : { actual: estimate.actual }),
      ...(snapshots.length === 0 || estimate == null
        ? {}
        : { expected: estimate.expected }),
      ...(hasContributionHistory
        ? { contributed: Math.round(contributed * 100) / 100 }
        : {}),
    };
  });
}

export type ProjectionPoint = {
  date: string;
  projected: number;
  /** The projected value deflated into today's money */
  real?: number;
};

type ProjectionInput = {
  accountId: AccountId;
  schedule: ReturnSchedule;
  startDate: string;
  startBalance: number;
  flows: RecurringFlow[];
  months: number;
  /** Latest balances of other accounts, for formula flows leaving this one */
  liabilityBalances?: Record<AccountId, number>;
  /** For liabilities: once paid off, payments stop instead of accumulating */
  clampAtZero?: boolean;
};

function isFlowActive(flow: RecurringFlow, date: string): boolean {
  return (
    flow.startDate <= date && (flow.endDate == null || date <= flow.endDate)
  );
}

function applyFlow(
  balance: number,
  flow: RecurringFlow,
  input: ProjectionInput,
): number {
  if (flow.toAccountId === input.accountId) {
    return balance + monthlyAmount(flow, balance);
  }
  if (flow.fromAccountId !== input.accountId) return balance;

  const counterpartBalance =
    flow.toAccountId == null
      ? undefined
      : input.liabilityBalances?.[flow.toAccountId];
  return balance - monthlyAmount(flow, counterpartBalance);
}

function applyActiveFlows(
  balance: number,
  date: string,
  input: ProjectionInput,
): number {
  return input.flows
    .filter((flow) => isFlowActive(flow, date))
    .reduce((current, flow) => applyFlow(current, flow, input), balance);
}

/**
 * Projects an account balance forward month by month: compound at the
 * expected return in force that month (rate changes respected), then apply
 * the recurring flows targeting or leaving the account.
 *
 * Formula flows (e.g. credit card minimum payments) are evaluated against
 * the running balance when this account is the liability being paid down.
 * When this account is the *source* of a formula payment, the counterparty
 * liability's latest balance (from `liabilityBalances`) is used as a
 * constant approximation.
 */
export function buildProjection(input: ProjectionInput): ProjectionPoint[] {
  const start = parseISO(input.startDate);
  let balance = input.startBalance;
  const points: ProjectionPoint[] = [
    { date: input.startDate, projected: Math.round(balance * 100) / 100 },
  ];
  for (let month = 1; month <= input.months; month++) {
    const date = format(addMonths(start, month), "yyyy-MM-dd");
    const rate = effectiveExpectedReturn(input.schedule, date);
    balance *= (1 + rate) ** (1 / 12);
    balance = applyActiveFlows(balance, date, input);
    if (input.clampAtZero && balance > 0) balance = 0;
    points.push({ date, projected: Math.round(balance * 100) / 100 });
  }
  return points;
}

type PortfolioProjectionAccount = Pick<
  Account,
  "id" | "expectedAnnualReturn" | "expectedReturnChanges"
> & {
  isOpen: boolean;
  latestBalance: number | null;
};

/**
 * Whole-portfolio projection: each open account projected from its latest
 * balance, then summed on the shared monthly grid. Transfers between owned
 * accounts cancel out of the total, so only external flows move it.
 */
export function buildPortfolioProjection(input: {
  accounts: PortfolioProjectionAccount[];
  flows: RecurringFlow[];
  startDate: string;
  months: number;
}): ProjectionPoint[] {
  const openAccounts = input.accounts.filter((account) => account.isOpen);
  const liabilityBalances = Object.fromEntries(
    openAccounts.map((account) => [account.id, account.latestBalance ?? 0]),
  );
  const perAccount = openAccounts.map((account) =>
    buildProjection({
      accountId: account.id,
      schedule: account,
      startDate: input.startDate,
      startBalance: account.latestBalance ?? 0,
      flows: input.flows,
      months: input.months,
      liabilityBalances,
      clampAtZero: (account.latestBalance ?? 0) < 0,
    }),
  );
  const grid = perAccount[0];
  if (!grid) return [];
  return grid.map((point, i) => ({
    date: point.date,
    projected:
      Math.round(
        perAccount.reduce(
          (sum, projection) => sum + (projection[i]?.projected ?? 0),
          0,
        ) * 100,
      ) / 100,
  }));
}

/** Adds inflation-adjusted values (today's money) to a projection */
export function addRealValues(
  points: ProjectionPoint[],
  inflation: number,
): ProjectionPoint[] {
  const startDate = points[0]?.date;
  if (startDate == null) return points;
  return points.map((point) => ({
    ...point,
    real:
      Math.round(
        (point.projected /
          (1 + inflation) ** yearsBetween(startDate, point.date)) *
          100,
      ) / 100,
  }));
}

/** First projected date at or above the target, or null if never reached */
export function projectedDateForTarget(
  points: ProjectionPoint[],
  target: number,
): string | null {
  return points.find((point) => point.projected >= target)?.date ?? null;
}

/**
 * If the recorded balance already meets the target (>= it), the date it was
 * reached — the start of the current unbroken run at or above the target.
 * Returns null when the latest balance is still below the target.
 */
export function dateTargetReached(
  snapshots: BalanceSnapshotView[],
  target: number,
): string | null {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last || last.balance < target) return null;
  let reached = last.date;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const snapshot = sorted[i];
    if (snapshot && snapshot.balance >= target) {
      reached = snapshot.date;
    } else {
      break;
    }
  }
  return reached;
}
