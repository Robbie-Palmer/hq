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
import { DEFAULT_BASE_CURRENCY } from "./currency";
import {
  convertAccountAmountAtDate,
  valuationDates,
  valueAccountAtDate,
  valuePortfolioAtDate,
} from "./portfolioValuation";
import { transferAmountFrom, transferAmountTo } from "./transfer";

function needsExplicitValuation(repository: AssetTrackerRepository): boolean {
  const baseCurrency =
    repository.settings.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  return (
    repository.holdingObservations.length > 0 ||
    Array.from(repository.accounts.values()).some(
      (account) => account.currency !== baseCurrency,
    )
  );
}

export function getAllAccountSummaries(
  repository: AssetTrackerRepository,
): AccountSummaryView[] {
  const valuationDate = valuationDates(repository).at(-1);
  return Array.from(repository.accounts.values()).map((account) => {
    const summary = toAccountSummaryView(
      account,
      repository.snapshots,
      repository.transfers,
      repository.capitalFlows,
    );
    if (
      valuationDate == null ||
      !repository.holdingObservations.some(
        (observation) => observation.accountId === account.id,
      )
    ) {
      return summary;
    }
    const valuation = valueAccountAtDate(repository, account, valuationDate);
    return {
      ...summary,
      latestBalance: valuation.nativeValue,
      latestSnapshotDate: valuationDate,
    };
  });
}

export function getAccountDetail(
  repository: AssetTrackerRepository,
  accountId: AccountId,
): AccountDetailView | null {
  const account = repository.accounts.get(accountId);
  if (!account) return null;
  const detail = toAccountDetailView(
    account,
    repository.snapshots,
    repository.transfers,
    repository.capitalFlows,
  );
  const valuationDate = valuationDates(repository).at(-1);
  if (
    valuationDate == null ||
    !repository.holdingObservations.some(
      (observation) => observation.accountId === account.id,
    )
  ) {
    return detail;
  }
  const valuation = valueAccountAtDate(repository, account, valuationDate);
  return {
    ...detail,
    latestBalance: valuation.nativeValue,
    latestSnapshotDate: valuationDate,
    gainLoss:
      valuation.nativeValue == null || detail.netContributed == null
        ? null
        : valuation.nativeValue - detail.netContributed,
  };
}

export function getAllAccountDetails(
  repository: AssetTrackerRepository,
): AccountDetailView[] {
  const valuationDate = valuationDates(repository).at(-1);
  return Array.from(repository.accounts.values()).map((account) => {
    const detail = toAccountDetailView(
      account,
      repository.snapshots,
      repository.transfers,
      repository.capitalFlows,
    );
    if (
      valuationDate == null ||
      !repository.holdingObservations.some(
        (observation) => observation.accountId === account.id,
      )
    ) {
      return detail;
    }
    const valuation = valueAccountAtDate(repository, account, valuationDate);
    return {
      ...detail,
      latestBalance: valuation.nativeValue,
      latestSnapshotDate: valuationDate,
      gainLoss:
        valuation.nativeValue == null || detail.netContributed == null
          ? null
          : valuation.nativeValue - detail.netContributed,
    };
  });
}

export function getAccountsByAssetType(
  repository: AssetTrackerRepository,
  assetType: AssetType,
): AccountSummaryView[] {
  return getAllAccountSummaries(repository).filter(
    (account) => account.assetType === assetType,
  );
}

export function getNetWorthTimeSeries(
  repository: AssetTrackerRepository,
): NetWorthDataPoint[] {
  if (needsExplicitValuation(repository)) {
    const accounts = Array.from(repository.accounts.values());
    const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);
    return valuationDates(repository).map((date) => {
      const valuation = valuePortfolioAtDate(repository, date);
      const point: NetWorthDataPoint = { date, total: valuation.total };
      for (const account of accounts) {
        if (
          absorbedIds.has(account.id) ||
          (account.closedAt != null && account.closedAt <= date)
        ) {
          continue;
        }
        const mortgageIds = mortgagesByProperty.get(account.id) ?? [];
        const componentValues = [account.id, ...mortgageIds]
          .filter((id) => {
            const closedAt = repository.accounts.get(id)?.closedAt;
            return closedAt == null || closedAt > date;
          })
          .map((id) => valuation.byAccount.get(id)?.value ?? null);
        if (componentValues.some((value) => value == null)) continue;
        point[account.name] = componentValues.reduce<number>(
          (sum, value) => sum + (value ?? 0),
          0,
        );
      }
      return point;
    });
  }
  return toNetWorthTimeSeries(
    Array.from(repository.accounts.values()),
    repository.snapshots,
    repository.capitalFlows,
  );
}

export function getLatestPortfolioValuation(
  repository: AssetTrackerRepository,
) {
  const date = valuationDates(repository).at(-1);
  return date == null ? null : valuePortfolioAtDate(repository, date);
}

export type PortfolioContributionDataPoint = {
  date: string;
  /** Deposits less withdrawals accumulated across the whole portfolio. */
  contributedCapital: number;
};

type BaseCurrencyFlow = { date: string; amount: number };

function convertCapitalFlows(
  repository: AssetTrackerRepository,
): BaseCurrencyFlow[] | null {
  const converted: BaseCurrencyFlow[] = [];
  for (const flow of repository.capitalFlows) {
    const amount = convertAccountAmountAtDate(
      repository,
      flow.accountId,
      flow.amount,
      flow.date,
    );
    if (amount == null) return null;
    converted.push({ date: flow.date, amount });
  }
  return converted;
}

function convertExternalTransfer(
  repository: AssetTrackerRepository,
  transfer: AssetTrackerRepository["transfers"][number],
): BaseCurrencyFlow | "internal" | null {
  if (transfer.fromAccountId == null && transfer.toAccountId != null) {
    const amount = convertAccountAmountAtDate(
      repository,
      transfer.toAccountId,
      transferAmountTo(transfer),
      transfer.date,
    );
    return amount == null ? null : { date: transfer.date, amount };
  }
  if (transfer.toAccountId == null && transfer.fromAccountId != null) {
    const amount = convertAccountAmountAtDate(
      repository,
      transfer.fromAccountId,
      transferAmountFrom(transfer),
      transfer.date,
    );
    return amount == null ? null : { date: transfer.date, amount: -amount };
  }
  return "internal";
}

function getExternalFlowsInBaseCurrency(
  repository: AssetTrackerRepository,
): BaseCurrencyFlow[] | null {
  const flows: BaseCurrencyFlow[] = [];
  for (const transfer of repository.transfers) {
    const converted = convertExternalTransfer(repository, transfer);
    if (converted == null) return null;
    if (converted !== "internal") flows.push(converted);
  }
  return flows;
}

/**
 * Portfolio-level cumulative contributed capital, kept independent of market
 * value. Equal signed flows for an internal transfer cancel in the total.
 */
export function getPortfolioContributionTimeSeries(
  repository: AssetTrackerRepository,
): PortfolioContributionDataPoint[] {
  const capitalFlows = convertCapitalFlows(repository);
  const externalTransfers = getExternalFlowsInBaseCurrency(repository);
  if (capitalFlows == null || externalTransfers == null) return [];
  const flows = [...capitalFlows, ...externalTransfers];
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

function buildValuedAllocationPoint(
  repository: AssetTrackerRepository,
  accounts: readonly Account[],
  absorbedIds: ReadonlySet<AccountId>,
  mortgagesByProperty: ReadonlyMap<AccountId, readonly AccountId[]>,
  date: string,
): AssetAllocationDataPoint | null {
  const valuation = valuePortfolioAtDate(repository, date);
  if (valuation.total == null) return null;
  const totals = new Map<AssetType, number>();
  for (const account of accounts) {
    if (isExcludedFromAllocation(account, date, absorbedIds)) continue;
    const ids = [account.id, ...(mortgagesByProperty.get(account.id) ?? [])];
    const values = ids.map((id) => valuation.byAccount.get(id)?.value ?? null);
    if (values.some((value) => value == null)) return null;
    const value = values.reduce<number>(
      (sum, current) => sum + (current ?? 0),
      0,
    );
    if (value <= 0) continue;
    totals.set(account.assetType, (totals.get(account.assetType) ?? 0) + value);
  }
  const totalAssets = [...totals.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  if (totalAssets <= 0) return null;
  const point: AssetAllocationDataPoint = { date, totalAssets };
  for (const [assetType, value] of totals) {
    point[assetType] = value / totalAssets;
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
  if (needsExplicitValuation(repository)) {
    const accounts = Array.from(repository.accounts.values());
    const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);
    return valuationDates(repository).flatMap((date) => {
      const point = buildValuedAllocationPoint(
        repository,
        accounts,
        absorbedIds,
        mortgagesByProperty,
        date,
      );
      return point == null ? [] : [point];
    });
  }
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
  if (netWorth.some((point) => point.total == null)) return null;
  const balances = netWorth.map((point) => ({
    date: point.date,
    balance: point.total ?? 0,
  }));
  const externalFlows: ExternalFlow[] | null =
    getExternalFlowsInBaseCurrency(repository);
  if (externalFlows == null) return null;
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
  if (needsExplicitValuation(repository)) {
    const date = valuationDates(repository).at(-1);
    if (date == null) return [];
    const valuation = valuePortfolioAtDate(repository, date);
    if (valuation.total == null) return [];
    const accounts = Array.from(repository.accounts.values());
    const { absorbedIds, mortgagesByProperty } = buildLinkage(accounts);
    const totals = new Map<AssetType, number>();
    for (const account of accounts) {
      if (absorbedIds.has(account.id) || account.closedAt != null) continue;
      const ids = [account.id, ...(mortgagesByProperty.get(account.id) ?? [])];
      const value = ids.reduce(
        (sum, id) => sum + (valuation.byAccount.get(id)?.value ?? 0),
        0,
      );
      totals.set(
        account.assetType,
        (totals.get(account.assetType) ?? 0) + value,
      );
    }
    return [...totals].map(([assetType, total]) => ({ assetType, total }));
  }
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
