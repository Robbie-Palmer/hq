import {
  type AddPlannedExpenditureInput,
  type AddRecurringFlowInput,
  type AssetTrackerData,
  AssetTrackerDataSchema,
  applyAddPlannedExpenditure,
  applyAddRecurringFlow,
  applyClearAccountHistory,
  applyClearIncomeHistory,
  applyCloseAccount,
  applyCreateAccount,
  applyDeleteCapitalFlow,
  applyDeletePlannedExpenditure,
  applyDeleteRecurringFlow,
  applyDeleteSnapshot,
  applyImportAccountHistory,
  applyImportIncomeHistory,
  applyMaterializeFlow,
  applyRecordBalance,
  applyRecordTransfer,
  applySetAccountLiquidity,
  applySetExpectedReturn,
  applySetInflation,
  applySetNetWorthTarget,
  applySetWithdrawalRate,
  buildRepository,
  type ClearAccountHistoryInput,
  type CloseAccountInput,
  type CreateAccountInput,
  type DeleteCapitalFlowInput,
  type DeletePlannedExpenditureInput,
  type DeleteRecurringFlowInput,
  type DeleteSnapshotInput,
  getEmptyData,
  getSeedData,
  type ImportAccountHistoryInput,
  type ImportIncomeHistoryInput,
  type MaterializeFlowInput,
  type RecordBalanceInput,
  type RecordTransferInput,
  type SetAccountLiquidityInput,
  type SetExpectedReturnInput,
  type SetInflationInput,
  type SetNetWorthTargetInput,
  type SetWithdrawalRateInput,
} from "@/lib/domain/assettracker";

/**
 * The Asset Tracker API boundary. Every method is async and mirrors the
 * endpoint a Cloudflare Worker + PostgreSQL backend would expose
 * (POST /accounts, PUT /balances, ...), so swapping the local implementation
 * for an HTTP client is a drop-in change. While the site is statically
 * generated, the "backend" is the same domain commands run against browser
 * storage.
 */
export interface AssetTrackerApi {
  load(): Promise<AssetTrackerLoadResult>;
  createAccount(input: CreateAccountInput): Promise<AssetTrackerData>;
  recordBalance(input: RecordBalanceInput): Promise<AssetTrackerData>;
  recordTransfer(input: RecordTransferInput): Promise<AssetTrackerData>;
  closeAccount(input: CloseAccountInput): Promise<AssetTrackerData>;
  clearAccountHistory(
    input: ClearAccountHistoryInput,
  ): Promise<AssetTrackerData>;
  deleteSnapshot(input: DeleteSnapshotInput): Promise<AssetTrackerData>;
  deleteCapitalFlow(input: DeleteCapitalFlowInput): Promise<AssetTrackerData>;
  importAccountHistory(
    input: ImportAccountHistoryInput,
  ): Promise<AssetTrackerData>;
  importIncomeHistory(
    input: ImportIncomeHistoryInput,
  ): Promise<AssetTrackerData>;
  clearIncomeHistory(): Promise<AssetTrackerData>;
  addRecurringFlow(input: AddRecurringFlowInput): Promise<AssetTrackerData>;
  addPlannedExpenditure(
    input: AddPlannedExpenditureInput,
  ): Promise<AssetTrackerData>;
  deleteRecurringFlow(
    input: DeleteRecurringFlowInput,
  ): Promise<AssetTrackerData>;
  deletePlannedExpenditure(
    input: DeletePlannedExpenditureInput,
  ): Promise<AssetTrackerData>;
  materializeFlow(input: MaterializeFlowInput): Promise<AssetTrackerData>;
  setExpectedReturn(input: SetExpectedReturnInput): Promise<AssetTrackerData>;
  setAccountLiquidity(
    input: SetAccountLiquidityInput,
  ): Promise<AssetTrackerData>;
  setInflation(input: SetInflationInput): Promise<AssetTrackerData>;
  setNetWorthTarget(input: SetNetWorthTargetInput): Promise<AssetTrackerData>;
  setWithdrawalRate(input: SetWithdrawalRateInput): Promise<AssetTrackerData>;
  importData(raw: unknown): Promise<AssetTrackerData>;
  clear(): Promise<AssetTrackerData>;
  reset(): Promise<AssetTrackerData>;
}

export type AssetTrackerLoadResult = {
  data: AssetTrackerData;
  /** True when the data carries the user's own changes rather than the pristine demo seed */
  persisted: boolean;
};

export const ASSET_TRACKER_STORAGE_KEY = "assettracker:data:v1";

function parseStored(raw: string): AssetTrackerData {
  const parsed = AssetTrackerDataSchema.parse(JSON.parse(raw));
  const incomeByDate = new Map(
    parsed.incomeHistory.map((record) => [record.date, record]),
  );
  // Earlier/hand-edited data may contain duplicate period ends. Keep the last
  // value so one bad series cannot hide the user's otherwise valid portfolio.
  const data =
    incomeByDate.size === parsed.incomeHistory.length
      ? parsed
      : {
          ...parsed,
          incomeHistory: Array.from(incomeByDate.values()).sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        };
  buildRepository(data); // referential integrity (duplicate IDs, orphan snapshots)
  return data;
}

export function createLocalAssetTrackerApi(storage: Storage): AssetTrackerApi {
  function readStored(): AssetTrackerData | null {
    const raw = storage.getItem(ASSET_TRACKER_STORAGE_KEY);
    if (raw == null) return null;
    try {
      return parseStored(raw);
    } catch {
      // Unreadable local data: fall back to the seed but leave the stored
      // value untouched until the next successful write
      return null;
    }
  }

  function write(data: AssetTrackerData): AssetTrackerData {
    storage.setItem(ASSET_TRACKER_STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  function current(): AssetTrackerData {
    return readStored() ?? getSeedData();
  }

  return {
    async load() {
      const stored = readStored();
      return { data: stored ?? getSeedData(), persisted: stored !== null };
    },
    async createAccount(input) {
      return write(applyCreateAccount(current(), input).data);
    },
    async recordBalance(input) {
      return write(applyRecordBalance(current(), input));
    },
    async recordTransfer(input) {
      return write(applyRecordTransfer(current(), input));
    },
    async closeAccount(input) {
      return write(applyCloseAccount(current(), input));
    },
    async clearAccountHistory(input) {
      return write(applyClearAccountHistory(current(), input));
    },
    async deleteSnapshot(input) {
      return write(applyDeleteSnapshot(current(), input));
    },
    async deleteCapitalFlow(input) {
      return write(applyDeleteCapitalFlow(current(), input));
    },
    async importAccountHistory(input) {
      return write(applyImportAccountHistory(current(), input));
    },
    async importIncomeHistory(input) {
      return write(applyImportIncomeHistory(current(), input));
    },
    async clearIncomeHistory() {
      return write(applyClearIncomeHistory(current()));
    },
    async addRecurringFlow(input) {
      return write(applyAddRecurringFlow(current(), input));
    },
    async addPlannedExpenditure(input) {
      return write(applyAddPlannedExpenditure(current(), input));
    },
    async deleteRecurringFlow(input) {
      return write(applyDeleteRecurringFlow(current(), input));
    },
    async deletePlannedExpenditure(input) {
      return write(applyDeletePlannedExpenditure(current(), input));
    },
    async materializeFlow(input) {
      return write(applyMaterializeFlow(current(), input));
    },
    async setExpectedReturn(input) {
      return write(applySetExpectedReturn(current(), input));
    },
    async setAccountLiquidity(input) {
      return write(applySetAccountLiquidity(current(), input));
    },
    async setInflation(input) {
      return write(applySetInflation(current(), input));
    },
    async setNetWorthTarget(input) {
      return write(applySetNetWorthTarget(current(), input));
    },
    async setWithdrawalRate(input) {
      return write(applySetWithdrawalRate(current(), input));
    },
    async importData(raw) {
      const data = AssetTrackerDataSchema.parse(raw);
      buildRepository(data);
      return write(data);
    },
    async clear() {
      return write(getEmptyData());
    },
    async reset() {
      storage.removeItem(ASSET_TRACKER_STORAGE_KEY);
      return getSeedData();
    },
  };
}
