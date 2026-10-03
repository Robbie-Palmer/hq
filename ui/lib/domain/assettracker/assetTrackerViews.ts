import {
  type Account,
  type AssetType,
  type ExpectedReturnChange,
  isLiability,
  type LiquidityTier,
} from "./account";
import {
  type BalanceEstimatePoint,
  buildBalanceEstimateSeries,
  computeMoneyWeightedReturn,
  type ExternalFlow,
} from "./assetTrackerAnalytics";
import type { BalanceSnapshot } from "./balanceSnapshot";
import type { CapitalFlow, CapitalFlowKind } from "./capitalFlow";
import type { Currency } from "./currency";
import type { Transfer } from "./transfer";
import { transferAmountFrom, transferAmountTo } from "./transfer";

function compareIsoDates(a: string, b: string): number {
  // BalanceSnapshotSchema guarantees canonical YYYY-MM-DD strings, for which
  // code-unit order is chronological and avoids timezone-dependent parsing.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Mortgages secured on a property are netted into that property so a home
 * shows as equity, not gross value, in totals and charts. Returns the set of
 * absorbed (linked-mortgage) account IDs and, per property, its mortgages.
 */
export function buildLinkage(accounts: Account[]): {
  absorbedIds: Set<string>;
  mortgagesByProperty: Map<string, string[]>;
} {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const absorbedIds = new Set<string>();
  const mortgagesByProperty = new Map<string, string[]>();
  for (const account of accounts) {
    if (account.assetType !== "mortgage" || account.linkedAccountId == null) {
      continue;
    }
    const property = byId.get(account.linkedAccountId);
    if (property?.assetType !== "property") continue;
    absorbedIds.add(account.id);
    const existing = mortgagesByProperty.get(property.id) ?? [];
    existing.push(account.id);
    mortgagesByProperty.set(property.id, existing);
  }
  return { absorbedIds, mortgagesByProperty };
}

export type AccountSummaryView = {
  id: string;
  name: string;
  provider: string;
  currency: Currency;
  assetType: AssetType;
  liquidity?: LiquidityTier;
  expectedAnnualReturn: number;
  isOpen: boolean;
  latestBalance: number | null;
  latestSnapshotDate: string | null;
  /**
   * Realised annual growth rate, excluding recorded transfers in/out so
   * contributions don't count as growth; null for closed accounts or
   * sparse data
   */
  cagr: number | null;
};

export type BalanceSnapshotView = {
  date: string;
  balance: number;
};

export type AccountDetailView = AccountSummaryView & {
  createdAt: string;
  closedAt?: string;
  expectedReturnChanges?: ExpectedReturnChange[];
  linkedAccountId?: string;
  mortgageTerms?: NonNullable<Account["mortgageTerms"]>;
  snapshots: BalanceSnapshotView[];
  capitalFlows: { date: string; amount: number; kind?: CapitalFlowKind }[];
  /** Deposits minus withdrawals recorded across the account history */
  netContributed: number | null;
  /** Current market value minus net contributed capital */
  gainLoss: number | null;
};

export type NetWorthExchangeRateDetail = {
  observationId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: number;
  source: string;
  effectiveDate: string;
  carriedForward: boolean;
  method: "direct" | "inverse" | "triangulated";
};

export type NetWorthAccountConversion = {
  accountId: string;
  accountName: string;
  nativeValue: number | null;
  nativeCurrency: Currency | null;
  convertedValue: number | null;
  rates: NetWorthExchangeRateDetail[];
  issues: Array<{
    kind: string;
    currency?: Currency;
    observedAt?: string;
  }>;
};

export type NetWorthConversionDetail = {
  targetCurrency: Currency;
  status: "complete" | "incomplete";
  partialTotal: number;
  accounts: NetWorthAccountConversion[];
};

export type NetWorthDataPoint = {
  date: string;
  /** Null when any required price or exchange rate is missing or stale. */
  total: number | null;
  /** Net worth with unvalued investments replaced by expected balances. */
  estimatedTotal?: number;
  /** Native amounts and the observations used to convert this point. */
  conversion?: NetWorthConversionDetail;
  [accountName: string]:
    | string
    | number
    | null
    | undefined
    | NetWorthConversionDetail;
};

export type FxImpactDataPoint = {
  date: string;
  actualTotal: number | null;
  fixedRateTotal: number | null;
  impact: number | null;
};

/**
 * Compares actual historical conversion with a counterfactual that freezes
 * each native currency at its first usable rate in the selected period.
 * Holdings, prices, balances, openings, and closures remain unchanged.
 */
export function toFxImpactTimeSeries(
  data: readonly NetWorthDataPoint[],
  baseCurrency: Currency,
): FxImpactDataPoint[] {
  const baselineRates = new Map<Currency, number>([[baseCurrency, 1]]);
  for (const point of data) {
    for (const account of point.conversion?.accounts ?? []) {
      if (
        account.nativeCurrency == null ||
        baselineRates.has(account.nativeCurrency) ||
        account.nativeValue == null ||
        account.nativeValue === 0 ||
        account.convertedValue == null
      ) {
        continue;
      }
      baselineRates.set(
        account.nativeCurrency,
        account.convertedValue / account.nativeValue,
      );
    }
  }

  return data.map((point) => {
    let fixedRateTotal = 0;
    let complete = point.conversion != null;
    for (const account of point.conversion?.accounts ?? []) {
      if (account.nativeValue == null || account.nativeCurrency == null) {
        complete = false;
        continue;
      }
      const rate = baselineRates.get(account.nativeCurrency);
      if (rate == null) {
        complete = false;
        continue;
      }
      fixedRateTotal += account.nativeValue * rate;
    }
    const fixed = complete ? fixedRateTotal : null;
    return {
      date: point.date,
      actualTotal: point.total,
      fixedRateTotal: fixed,
      impact: point.total == null || fixed == null ? null : point.total - fixed,
    };
  });
}

export function hasFxExposure(
  data: readonly NetWorthDataPoint[],
  baseCurrency: Currency,
): boolean {
  return data.some((point) =>
    point.conversion?.accounts.some(
      (account) =>
        account.nativeValue != null && account.nativeCurrency !== baseCurrency,
    ),
  );
}

export type EquitySummary = {
  propertyName: string;
  value: number;
};

/**
 * Home equity from the account's perspective: for a property, its value plus
 * the (negative) balances of open mortgages secured on it; for a mortgage,
 * the linked property's value plus this balance. Null when nothing is linked.
 */
export function computeEquitySummary(
  account: AccountDetailView,
  allAccounts: AccountDetailView[],
): EquitySummary | null {
  if (account.assetType === "property") {
    const mortgages = allAccounts.filter(
      (a) => a.linkedAccountId === account.id && a.isOpen,
    );
    if (mortgages.length === 0) return null;
    const mortgageTotal = mortgages.reduce(
      (sum, mortgage) => sum + (mortgage.latestBalance ?? 0),
      0,
    );
    return {
      propertyName: account.name,
      value: (account.latestBalance ?? 0) + mortgageTotal,
    };
  }
  if (account.linkedAccountId == null) return null;
  const property = allAccounts.find((a) => a.id === account.linkedAccountId);
  if (!property) return null;
  return {
    propertyName: property.name,
    value: (property.latestBalance ?? 0) + (account.latestBalance ?? 0),
  };
}

/**
 * Selects recorded capital history when present, otherwise deriving signed
 * external flows from transfers into and out of the account.
 */
export function selectAccountExternalFlows(
  accountId: string,
  transfers: Transfer[],
  recordedCapital: ExternalFlow[],
): ExternalFlow[] {
  // Pasted capital history is authoritative when present. Falling back keeps
  // existing transfer-driven accounts compatible without double counting.
  if (recordedCapital.length > 0) return recordedCapital;
  const flows: ExternalFlow[] = [];
  for (const transfer of transfers) {
    if (transfer.toAccountId === accountId) {
      flows.push({ date: transfer.date, amount: transferAmountTo(transfer) });
    } else if (transfer.fromAccountId === accountId) {
      flows.push({
        date: transfer.date,
        amount: -transferAmountFrom(transfer),
      });
    }
  }
  return flows;
}

function toExternalFlows(
  accountId: string,
  transfers: Transfer[],
  capitalFlows: CapitalFlow[],
): ExternalFlow[] {
  return selectAccountExternalFlows(
    accountId,
    transfers,
    capitalFlows
      .filter((flow) => flow.accountId === accountId)
      .map((flow) => ({ date: flow.date, amount: flow.amount })),
  );
}

export type AccountReadModel = {
  summary: AccountSummaryView;
  detail: AccountDetailView;
};

/** Builds both account views from one sorted snapshot and capital-flow set. */
export function buildAccountReadModel(
  account: Account,
  snapshots: BalanceSnapshot[],
  transfers: Transfer[] = [],
  capitalFlows: CapitalFlow[] = [],
): AccountReadModel {
  const accountSnapshots = snapshots
    .filter((s) => s.accountId === account.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = accountSnapshots[0] ?? null;
  const accountCapitalFlows = capitalFlows
    .filter((flow) => flow.accountId === account.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const netContributed =
    accountCapitalFlows.length === 0
      ? null
      : accountCapitalFlows.reduce((sum, flow) => sum + flow.amount, 0);
  const externalFlows = toExternalFlows(account.id, transfers, capitalFlows);
  const common = {
    id: account.id,
    name: account.name,
    provider: account.provider,
    currency: account.currency,
    assetType: account.assetType,
    liquidity: account.liquidity,
    expectedAnnualReturn: account.expectedAnnualReturn,
    isOpen: !account.closedAt,
    latestBalance: latest?.balance ?? null,
    latestSnapshotDate: latest?.date ?? null,
  };
  const summary: AccountSummaryView = {
    ...common,
    cagr:
      account.closedAt || isLiability(account.assetType)
        ? null
        : computeMoneyWeightedReturn(accountSnapshots, externalFlows),
  };
  const detail: AccountDetailView = {
    ...common,
    cagr: account.closedAt
      ? null
      : computeMoneyWeightedReturn(accountSnapshots, externalFlows),
    createdAt: account.createdAt,
    expectedReturnChanges: account.expectedReturnChanges,
    linkedAccountId: account.linkedAccountId,
    mortgageTerms: account.mortgageTerms,
    closedAt: account.closedAt,
    snapshots: accountSnapshots
      .map((snapshot) => ({
        date: snapshot.date,
        balance: snapshot.balance,
      }))
      .reverse(),
    capitalFlows: accountCapitalFlows.map(({ date, amount, kind }) => ({
      date,
      amount,
      kind,
    })),
    netContributed,
    gainLoss:
      latest == null || netContributed == null
        ? null
        : latest.balance - netContributed,
  };
  return { summary, detail };
}

export function toAccountSummaryView(
  account: Account,
  snapshots: BalanceSnapshot[],
  transfers: Transfer[] = [],
  capitalFlows: CapitalFlow[] = [],
): AccountSummaryView {
  return buildAccountReadModel(account, snapshots, transfers, capitalFlows)
    .summary;
}

export function toAccountDetailView(
  account: Account,
  snapshots: BalanceSnapshot[],
  transfers: Transfer[] = [],
  capitalFlows: CapitalFlow[] = [],
): AccountDetailView {
  return buildAccountReadModel(account, snapshots, transfers, capitalFlows)
    .detail;
}

function accountHasRecordedValue(
  accountId: string,
  mortgageIds: readonly string[],
  recordedAccountIds: Readonly<{ has(value: string): boolean }>,
): boolean {
  return (
    recordedAccountIds.has(accountId) ||
    mortgageIds.some((mortgageId) => recordedAccountIds.has(mortgageId))
  );
}

function recordedBalanceWithMortgages(
  accountId: string,
  mortgageIds: readonly string[],
  latestByAccount: ReadonlyMap<string, number>,
): number {
  return mortgageIds.reduce(
    (balance, mortgageId) => balance + (latestByAccount.get(mortgageId) ?? 0),
    latestByAccount.get(accountId) ?? 0,
  );
}

function recordedNetWorthPoint(
  date: string,
  accounts: readonly Account[],
  accountById: ReadonlyMap<string, Account>,
  absorbedIds: ReadonlySet<string>,
  mortgagesByProperty: ReadonlyMap<string, string[]>,
  accountsWithMarketValue: ReadonlySet<string>,
  latestByAccount: ReadonlyMap<string, number>,
): NetWorthDataPoint {
  const point: NetWorthDataPoint = { date, total: 0 };
  for (const account of accounts) {
    if (
      absorbedIds.has(account.id) ||
      (account.closedAt != null && account.closedAt <= date)
    ) {
      continue;
    }
    const mortgageIds = (mortgagesByProperty.get(account.id) ?? []).filter(
      (mortgageId) => {
        const closedAt = accountById.get(mortgageId)?.closedAt;
        return closedAt == null || closedAt > date;
      },
    );
    const hasMarketHistory = accountHasRecordedValue(
      account.id,
      mortgageIds,
      accountsWithMarketValue,
    );
    const hasRecordedBalance = accountHasRecordedValue(
      account.id,
      mortgageIds,
      latestByAccount,
    );
    // A contribution history is not a market valuation. Leave accounts out
    // until they or a linked mortgage have a recorded balance.
    if (!hasMarketHistory || !hasRecordedBalance) continue;
    const balance = recordedBalanceWithMortgages(
      account.id,
      mortgageIds,
      latestByAccount,
    );
    point[account.name] = balance;
    point.total = (point.total ?? 0) + balance;
  }
  return point;
}

function withEstimatedNetWorth(
  point: NetWorthDataPoint,
  date: string,
  accounts: readonly Account[],
  accountsWithMarketValue: ReadonlySet<string>,
  latestByAccount: ReadonlyMap<string, number>,
  estimatesByAccount: ReadonlyMap<
    string,
    ReadonlyMap<string, BalanceEstimatePoint>
  >,
): NetWorthDataPoint {
  let estimatedTotal = point.total ?? 0;
  let usesEstimate = false;
  for (const account of accounts) {
    if (account.closedAt != null && account.closedAt <= date) continue;
    const estimate = estimatesByAccount.get(account.id)?.get(date);
    if (estimate == null || estimate.actual != null) continue;
    const recordedBalance = accountsWithMarketValue.has(account.id)
      ? (latestByAccount.get(account.id) ?? 0)
      : 0;
    estimatedTotal += estimate.estimated - recordedBalance;
    usesEstimate = true;
  }
  if (!usesEstimate) return point;
  return {
    ...point,
    estimatedTotal: Math.round(estimatedTotal * 100) / 100,
  };
}

export function toNetWorthTimeSeries(
  accounts: Account[],
  snapshots: BalanceSnapshot[],
  capitalFlows: CapitalFlow[] = [],
): NetWorthDataPoint[] {
  const dateSet = new Set([
    ...snapshots.map((snapshot) => snapshot.date),
    ...capitalFlows.map((flow) => flow.date),
  ]);
  const sortedDates = Array.from(dateSet).sort(compareIsoDates);
  const accountsWithMarketValue = new Set(
    snapshots
      .filter((snapshot) => snapshot.balance !== 0)
      .map((snapshot) => snapshot.accountId),
  );

  const sortedSnapshots = [...snapshots].sort((a, b) =>
    compareIsoDates(a.date, b.date),
  );

  // Two-pointer approach: process each snapshot only once
  const latestByAccount = new Map<string, number>();
  let snapshotIndex = 0;

  // A linked mortgage is folded into its property's series (shown as equity)
  // rather than appearing as its own negative series
  const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const estimatedInvestmentTypes = new Set<AssetType>([
    "stocks",
    "bonds",
    "reits",
    "crypto",
  ]);
  const estimatesByAccount = new Map(
    accounts
      .filter(
        (account) =>
          estimatedInvestmentTypes.has(account.assetType) &&
          !absorbedIds.has(account.id),
      )
      .map((account) => [
        account.id,
        new Map(
          buildBalanceEstimateSeries(
            account,
            snapshots.filter((snapshot) => snapshot.accountId === account.id),
            capitalFlows
              .filter((flow) => flow.accountId === account.id)
              .map(({ date, amount }) => ({ date, amount })),
            sortedDates,
          ).map((point) => [point.date, point]),
        ),
      ]),
  );

  return sortedDates.map((date) => {
    // Advance pointer through snapshots up to current date
    let snapshot = sortedSnapshots[snapshotIndex];
    while (snapshot && compareIsoDates(snapshot.date, date) <= 0) {
      latestByAccount.set(snapshot.accountId, snapshot.balance);
      snapshotIndex++;
      snapshot = sortedSnapshots[snapshotIndex];
    }

    const point = recordedNetWorthPoint(
      date,
      accounts,
      accountById,
      absorbedIds,
      mortgagesByProperty,
      accountsWithMarketValue,
      latestByAccount,
    );
    return withEstimatedNetWorth(
      point,
      date,
      accounts,
      accountsWithMarketValue,
      latestByAccount,
      estimatesByAccount,
    );
  });
}
