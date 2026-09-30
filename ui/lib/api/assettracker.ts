import { todayIsoDate } from "@/lib/assettracker/date";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
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
  applySetBaseCurrency,
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
  type ImportAccountHistoryInput,
  type ImportIncomeHistoryInput,
  type MaterializeFlowInput,
  type RecordBalanceInput,
  type RecordTransferInput,
  type SetAccountLiquidityInput,
  type SetBaseCurrencyInput,
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
  setBaseCurrency(input: SetBaseCurrencyInput): Promise<AssetTrackerData>;
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

function promiseFromSync<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createLocalAssetTrackerApi(storage: Storage): AssetTrackerApi {
  const currentDate = () => todayIsoDate();
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
    return readStored() ?? getDemoAssetTrackerData();
  }

  return {
    load() {
      return promiseFromSync(() => {
        const stored = readStored();
        return {
          data: stored ?? getDemoAssetTrackerData(),
          persisted: stored !== null,
        };
      });
    },
    createAccount(input) {
      return promiseFromSync(() =>
        write(applyCreateAccount(current(), input, currentDate()).data),
      );
    },
    recordBalance(input) {
      return promiseFromSync(() => write(applyRecordBalance(current(), input)));
    },
    recordTransfer(input) {
      return promiseFromSync(() =>
        write(applyRecordTransfer(current(), input)),
      );
    },
    closeAccount(input) {
      return promiseFromSync(() => write(applyCloseAccount(current(), input)));
    },
    clearAccountHistory(input) {
      return promiseFromSync(() =>
        write(applyClearAccountHistory(current(), input)),
      );
    },
    deleteSnapshot(input) {
      return promiseFromSync(() =>
        write(applyDeleteSnapshot(current(), input)),
      );
    },
    deleteCapitalFlow(input) {
      return promiseFromSync(() =>
        write(applyDeleteCapitalFlow(current(), input)),
      );
    },
    importAccountHistory(input) {
      return promiseFromSync(() =>
        write(applyImportAccountHistory(current(), input)),
      );
    },
    importIncomeHistory(input) {
      return promiseFromSync(() =>
        write(applyImportIncomeHistory(current(), input)),
      );
    },
    clearIncomeHistory() {
      return promiseFromSync(() => write(applyClearIncomeHistory(current())));
    },
    addRecurringFlow(input) {
      return promiseFromSync(() =>
        write(applyAddRecurringFlow(current(), input, currentDate())),
      );
    },
    addPlannedExpenditure(input) {
      return promiseFromSync(() =>
        write(applyAddPlannedExpenditure(current(), input, currentDate())),
      );
    },
    deleteRecurringFlow(input) {
      return promiseFromSync(() =>
        write(applyDeleteRecurringFlow(current(), input)),
      );
    },
    deletePlannedExpenditure(input) {
      return promiseFromSync(() =>
        write(applyDeletePlannedExpenditure(current(), input)),
      );
    },
    materializeFlow(input) {
      return promiseFromSync(() =>
        write(applyMaterializeFlow(current(), input)),
      );
    },
    setExpectedReturn(input) {
      return promiseFromSync(() =>
        write(applySetExpectedReturn(current(), input)),
      );
    },
    setAccountLiquidity(input) {
      return promiseFromSync(() =>
        write(applySetAccountLiquidity(current(), input)),
      );
    },
    setBaseCurrency(input) {
      return promiseFromSync(() =>
        write(applySetBaseCurrency(current(), input)),
      );
    },
    setInflation(input) {
      return promiseFromSync(() => write(applySetInflation(current(), input)));
    },
    setNetWorthTarget(input) {
      return promiseFromSync(() =>
        write(applySetNetWorthTarget(current(), input)),
      );
    },
    setWithdrawalRate(input) {
      return promiseFromSync(() =>
        write(applySetWithdrawalRate(current(), input)),
      );
    },
    importData(raw) {
      return promiseFromSync(() => {
        const data = AssetTrackerDataSchema.parse(raw);
        buildRepository(data);
        return write(data);
      });
    },
    clear() {
      return promiseFromSync(() => write(getEmptyData()));
    },
    reset() {
      return promiseFromSync(() => {
        storage.removeItem(ASSET_TRACKER_STORAGE_KEY);
        return getDemoAssetTrackerData();
      });
    },
  };
}
