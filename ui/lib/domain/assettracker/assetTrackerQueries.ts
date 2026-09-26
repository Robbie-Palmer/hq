import {
  type Account,
  type AccountId,
  type AssetType,
  isLiability,
} from "./account";
import {
  computeMoneyWeightedReturn,
  type ExternalFlow,
} from "./assetTrackerAnalytics";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import {
  type AccountDetailView,
  type AccountSummaryView,
  buildLinkage,
  type NetWorthDataPoint,
  toAccountDetailView,
  toAccountSummaryView,
  toNetWorthTimeSeries,
} from "./assetTrackerViews";
import type { BalanceSnapshot } from "./balanceSnapshot";

export function getAllAccountSummaries(
  repository: AssetTrackerRepository,
): AccountSummaryView[] {
  return Array.from(repository.accounts.values()).map((account) =>
    toAccountSummaryView(
      account,
      repository.snapshots,
      repository.transfers,
      repository.capitalFlows,
    ),
  );
}

export function getAccountDetail(
  repository: AssetTrackerRepository,
  accountId: AccountId,
): AccountDetailView | null {
  const account = repository.accounts.get(accountId);
  if (!account) return null;
  return toAccountDetailView(
    account,
    repository.snapshots,
    repository.transfers,
    repository.capitalFlows,
  );
}

export function getAllAccountDetails(
  repository: AssetTrackerRepository,
): AccountDetailView[] {
  return Array.from(repository.accounts.values()).map((account) =>
    toAccountDetailView(
      account,
      repository.snapshots,
      repository.transfers,
      repository.capitalFlows,
    ),
  );
}

export function getAccountsByAssetType(
  repository: AssetTrackerRepository,
  assetType: AssetType,
): AccountSummaryView[] {
  return Array.from(repository.accounts.values())
    .filter((account) => account.assetType === assetType)
    .map((account) =>
      toAccountSummaryView(
        account,
        repository.snapshots,
        repository.transfers,
        repository.capitalFlows,
      ),
    );
}

export function getNetWorthTimeSeries(
  repository: AssetTrackerRepository,
): NetWorthDataPoint[] {
  return toNetWorthTimeSeries(
    Array.from(repository.accounts.values()),
    repository.snapshots,
    repository.capitalFlows,
  );
}

export type PortfolioContributionDataPoint = {
  date: string;
  /** Deposits less withdrawals accumulated across the whole portfolio. */
  contributedCapital: number;
};

/**
 * Portfolio-level cumulative contributed capital, kept independent of market
 * value. Equal signed flows for an internal transfer cancel in the total.
 */
export function getPortfolioContributionTimeSeries(
  repository: AssetTrackerRepository,
): PortfolioContributionDataPoint[] {
  const flows = repository.capitalFlows.map(({ date, amount }) => ({
    date,
    amount,
  }));
  for (const transfer of repository.transfers) {
    if (transfer.fromAccountId == null && transfer.toAccountId != null) {
      flows.push({ date: transfer.date, amount: transfer.amount });
    } else if (transfer.toAccountId == null && transfer.fromAccountId != null) {
      flows.push({ date: transfer.date, amount: -transfer.amount });
    }
  }
  flows.sort((a, b) => a.date.localeCompare(b.date));

  const points: PortfolioContributionDataPoint[] = [];
  let contributedCapital = 0;
  for (const flow of flows) {
    contributedCapital =
      Math.round((contributedCapital + flow.amount) * 100) / 100;
    const currentDate = points.at(-1);
    if (currentDate?.date === flow.date) {
      currentDate.contributedCapital = contributedCapital;
    } else {
      points.push({ date: flow.date, contributedCapital });
    }
  }
  return points;
}

export type AssetAllocationDataPoint = {
  date: string;
  /** Positive net asset buckets used as the percentage denominator. */
  totalAssets: number;
} & Partial<Record<AssetType, number>>;

function isExcludedFromAllocation(
  account: Account,
  date: string,
  absorbedIds: ReadonlySet<AccountId>,
): boolean {
  return (
    absorbedIds.has(account.id) ||
    isLiability(account.assetType) ||
    (account.closedAt != null && account.closedAt <= date)
  );
}

function getNetAssetBalance(
  account: Account,
  date: string,
  latestByAccount: ReadonlyMap<AccountId, number>,
  mortgagesByProperty: ReadonlyMap<AccountId, readonly AccountId[]>,
  accountsById: ReadonlyMap<AccountId, Account>,
): number | null {
  let balance = latestByAccount.get(account.id);
  if (balance == null) return null;

  for (const mortgageId of mortgagesByProperty.get(account.id) ?? []) {
    const mortgage = accountsById.get(mortgageId);
    if (mortgage?.closedAt != null && mortgage.closedAt <= date) continue;
    balance += latestByAccount.get(mortgageId) ?? 0;
  }
  return balance;
}

function buildAllocationPoint(
  date: string,
  accounts: readonly Account[],
  accountsById: ReadonlyMap<AccountId, Account>,
  latestByAccount: ReadonlyMap<AccountId, number>,
  absorbedIds: ReadonlySet<AccountId>,
  mortgagesByProperty: ReadonlyMap<AccountId, readonly AccountId[]>,
): AssetAllocationDataPoint | null {
  const totals = new Map<AssetType, number>();
  for (const account of accounts) {
    if (isExcludedFromAllocation(account, date, absorbedIds)) continue;
    const balance = getNetAssetBalance(
      account,
      date,
      latestByAccount,
      mortgagesByProperty,
      accountsById,
    );
    if (balance == null || balance <= 0) continue;
    totals.set(
      account.assetType,
      (totals.get(account.assetType) ?? 0) + balance,
    );
  }

  const totalAssets = Array.from(totals.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (totalAssets <= 0) return null;

  const point: AssetAllocationDataPoint = { date, totalAssets };
  for (const [assetType, total] of totals) {
    point[assetType] = total / totalAssets;
  }
  return point;
}

/**
 * Percentage allocation through time, using the same linkage model as the
 * current composition chart. A linked mortgage therefore reduces property to
 * home equity. Standalone liabilities and other negative buckets are excluded
 * because this is allocation *within assets*, not another net-worth series.
 */
export function getAssetAllocationTimeSeries(
  repository: AssetTrackerRepository,
): AssetAllocationDataPoint[] {
  const accounts = Array.from(repository.accounts.values());
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  const dates = Array.from(
    new Set(repository.snapshots.map((snapshot) => snapshot.date)),
  ).sort((a, b) => a.localeCompare(b));
  const snapshots = repository.snapshots.toSorted((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latestByAccount = new Map<AccountId, number>();
  const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);
  let snapshotIndex = 0;
  const points: AssetAllocationDataPoint[] = [];

  for (const date of dates) {
    let snapshot = snapshots[snapshotIndex];
    while (snapshot && snapshot.date <= date) {
      latestByAccount.set(snapshot.accountId, snapshot.balance);
      snapshotIndex++;
      snapshot = snapshots[snapshotIndex];
    }
    const point = buildAllocationPoint(
      date,
      accounts,
      accountsById,
      latestByAccount,
      absorbedIds,
      mortgagesByProperty,
    );
    if (point) points.push(point);
  }
  return points;
}

/**
 * Annualised growth of the whole portfolio, excluding external money in/out
 * (recorded transfers with an external side). Internal transfers between
 * accounts cancel out of the net worth total, so they need no adjustment.
 */
export function getPortfolioAnnualReturn(
  repository: AssetTrackerRepository,
): number | null {
  const netWorth = getNetWorthTimeSeries(repository);
  const balances = netWorth.map((point) => ({
    date: point.date,
    balance: point.total,
  }));
  const externalFlows: ExternalFlow[] = [];
  for (const transfer of repository.transfers) {
    if (transfer.fromAccountId == null && transfer.toAccountId != null) {
      externalFlows.push({ date: transfer.date, amount: transfer.amount });
    } else if (transfer.toAccountId == null && transfer.fromAccountId != null) {
      externalFlows.push({ date: transfer.date, amount: -transfer.amount });
    }
  }
  return computeMoneyWeightedReturn(balances, externalFlows);
}

/**
 * Net worth composition by asset type. Mortgages secured on a property are
 * folded into that property (so it contributes equity, not gross value);
 * other liabilities surface as their own negative totals.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function getTotalByAssetType(
  repository: AssetTrackerRepository,
): { assetType: AssetType; total: number }[] {
  const totals = new Map<AssetType, number>();

  // Find latest snapshot for each account in single pass
  const latestSnapshots = new Map<AccountId, BalanceSnapshot>();
  for (const snapshot of repository.snapshots) {
    const existing = latestSnapshots.get(snapshot.accountId);
    if (!existing || new Date(snapshot.date) > new Date(existing.date)) {
      latestSnapshots.set(snapshot.accountId, snapshot);
    }
  }

  const accounts = Array.from(repository.accounts.values());
  const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);

  for (const account of accounts) {
    if (absorbedIds.has(account.id) || account.closedAt != null) continue;
    let balance = latestSnapshots.get(account.id)?.balance ?? 0;
    for (const mortgageId of mortgagesByProperty.get(account.id) ?? []) {
      if (repository.accounts.get(mortgageId)?.closedAt != null) continue;
      balance += latestSnapshots.get(mortgageId)?.balance ?? 0;
    }
    totals.set(
      account.assetType,
      (totals.get(account.assetType) ?? 0) + balance,
    );
  }

  return Array.from(totals.entries()).map(([assetType, total]) => ({
    assetType,
    total,
  }));
}
