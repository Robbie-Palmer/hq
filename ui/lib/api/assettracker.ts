import { promiseFromSync } from "ts-base/promises";
import { todayIsoDate } from "@/lib/assettracker/date";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import {
  type AddCashFlowDecisionInput,
  type AddCommitmentInput,
  type AddForecastAssumptionInput,
  type AddHouseholdMemberInput,
  type AddPlannedExpenditureInput,
  type AddRecurringFlowInput,
  type AssetTrackerBackup,
  type AssetTrackerData,
  AssetTrackerDataSchema,
  applyAddCashFlowDecision,
  applyAddCommitment,
  applyAddForecastAssumption,
  applyAddHouseholdMember,
  applyAddPlannedExpenditure,
  applyAddRecurringFlow,
  applyClearAccountHistory,
  applyClearIncomeHistory,
  applyCloseAccount,
  applyCreateAccount,
  applyCreateForecastAssumptionSet,
  applyCreatePlanningCase,
  applyDeleteCapitalFlow,
  applyDeleteForecastAssumption,
  applyDeleteFutureCashFlow,
  applyDeleteJobMoveScenario,
  applyDeletePlannedExpenditure,
  applyDeleteRecurringFlow,
  applyDeleteSalaryRecord,
  applyDeleteSnapshot,
  applyDuplicateJobMoveScenario,
  applyImportAccountHistory,
  applyImportIncomeHistory,
  applyImportSalaryHistory,
  applyMaterializeFlow,
  applyRecordActualCashFlow,
  applyRecordBalance,
  applyRecordTransfer,
  applyRenameHouseholdMember,
  applySaveEmergencyFundPlan,
  applySaveJobMoveScenario,
  applySaveMortgageScenario,
  applySaveSalaryRecord,
  applySaveTaxSetup,
  applySetAccountLiquidity,
  applySetAccountOwnership,
  applySetActiveHouseholdScope,
  applySetBaseCurrency,
  applySetCashFlowDecisionStatus,
  applySetCommitmentStatus,
  applySetExpectedReturn,
  applySetInflation,
  applySetMortgageTerms,
  applySetNetWorthTarget,
  applySetWithdrawalRate,
  applyUpdateCashFlowDecision,
  applyVersionForecastAssumptionSet,
  buildRepository,
  type ClearAccountHistoryInput,
  type CloseAccountInput,
  type CreateAccountInput,
  type CreateForecastAssumptionSetInput,
  type CreatePlanningCaseInput,
  type DeleteCapitalFlowInput,
  type DeleteForecastAssumptionInput,
  type DeleteFutureCashFlowInput,
  type DeletePlannedExpenditureInput,
  type DeleteRecurringFlowInput,
  type DeleteSalaryRecordInput,
  type DeleteSnapshotInput,
  getEmptyData,
  type HouseholdScope,
  type ImportAccountHistoryInput,
  type ImportIncomeHistoryInput,
  type ImportSalaryHistoryInput,
  type JobMoveScenarioIdInput,
  type MaterializeFlowInput,
  parseAssetTrackerBackup,
  type RecordActualCashFlowInput,
  type RecordBalanceInput,
  type RecordTransferInput,
  type RenameHouseholdMemberInput,
  type SaveEmergencyFundPlanInput,
  type SaveJobMoveScenarioInput,
  type SaveMortgageScenarioInput,
  type SaveSalaryRecordInput,
  type SaveTaxSetupInput,
  type SetAccountLiquidityInput,
  type SetAccountOwnershipInput,
  type SetBaseCurrencyInput,
  type SetCashFlowDecisionStatusInput,
  type SetCommitmentStatusInput,
  type SetExpectedReturnInput,
  type SetInflationInput,
  type SetMortgageTermsInput,
  type SetNetWorthTargetInput,
  type SetWithdrawalRateInput,
  type UpdateCashFlowDecisionInput,
  type VersionForecastAssumptionSetInput,
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
  importSalaryHistory(
    input: ImportSalaryHistoryInput,
  ): Promise<AssetTrackerData>;
  saveSalaryRecord(input: SaveSalaryRecordInput): Promise<AssetTrackerData>;
  deleteSalaryRecord(input: DeleteSalaryRecordInput): Promise<AssetTrackerData>;
  saveTaxSetup(input: SaveTaxSetupInput): Promise<AssetTrackerData>;
  clearIncomeHistory(): Promise<AssetTrackerData>;
  addRecurringFlow(input: AddRecurringFlowInput): Promise<AssetTrackerData>;
  createPlanningCase(input: CreatePlanningCaseInput): Promise<AssetTrackerData>;
  addCommitment(input: AddCommitmentInput): Promise<AssetTrackerData>;
  addCashFlowDecision(
    input: AddCashFlowDecisionInput,
  ): Promise<AssetTrackerData>;
  updateCashFlowDecision(
    input: UpdateCashFlowDecisionInput,
  ): Promise<AssetTrackerData>;
  setCashFlowDecisionStatus(
    input: SetCashFlowDecisionStatusInput,
  ): Promise<AssetTrackerData>;
  setCommitmentStatus(
    input: SetCommitmentStatusInput,
  ): Promise<AssetTrackerData>;
  recordActualCashFlow(
    input: RecordActualCashFlowInput,
  ): Promise<AssetTrackerData>;
  deleteFutureCashFlow(
    input: DeleteFutureCashFlowInput,
  ): Promise<AssetTrackerData>;
  createForecastAssumptionSet(
    input: CreateForecastAssumptionSetInput,
  ): Promise<AssetTrackerData>;
  addForecastAssumption(
    input: AddForecastAssumptionInput,
  ): Promise<AssetTrackerData>;
  versionForecastAssumptionSet(
    input: VersionForecastAssumptionSetInput,
  ): Promise<AssetTrackerData>;
  deleteForecastAssumption(
    input: DeleteForecastAssumptionInput,
  ): Promise<AssetTrackerData>;
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
  setMortgageTerms(input: SetMortgageTermsInput): Promise<AssetTrackerData>;
  setBaseCurrency(input: SetBaseCurrencyInput): Promise<AssetTrackerData>;
  setInflation(input: SetInflationInput): Promise<AssetTrackerData>;
  setNetWorthTarget(input: SetNetWorthTargetInput): Promise<AssetTrackerData>;
  setWithdrawalRate(input: SetWithdrawalRateInput): Promise<AssetTrackerData>;
  saveMortgageScenario(
    input: SaveMortgageScenarioInput,
  ): Promise<AssetTrackerData>;
  saveEmergencyFundPlan(
    input: SaveEmergencyFundPlanInput,
  ): Promise<AssetTrackerData>;
  saveJobMoveScenario(
    input: SaveJobMoveScenarioInput,
  ): Promise<AssetTrackerData>;
  duplicateJobMoveScenario(
    input: JobMoveScenarioIdInput,
  ): Promise<AssetTrackerData>;
  deleteJobMoveScenario(
    input: JobMoveScenarioIdInput,
  ): Promise<AssetTrackerData>;
  addHouseholdMember(input: AddHouseholdMemberInput): Promise<AssetTrackerData>;
  renameHouseholdMember(
    input: RenameHouseholdMemberInput,
  ): Promise<AssetTrackerData>;
  setActiveHouseholdScope(scope: HouseholdScope): Promise<AssetTrackerData>;
  setAccountOwnership(
    input: SetAccountOwnershipInput,
  ): Promise<AssetTrackerData>;
  importData(raw: unknown): Promise<AssetTrackerData>;
  restoreBackup(backup: AssetTrackerBackup): Promise<AssetTrackerData>;
  clear(): Promise<AssetTrackerData>;
  reset(): Promise<AssetTrackerData>;
}

export type AssetTrackerLoadResult = {
  data: AssetTrackerData;
  /** True when the data carries the user's own changes rather than the pristine demo seed */
  persisted: boolean;
};

export const ASSET_TRACKER_STORAGE_KEY = "assettracker:data:v1";

export class AssetTrackerStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssetTrackerStorageError";
  }
}

const NO_PENSION_CONTRIBUTION_MARKER =
  "assetTrackerConfirmedNoPensionContribution";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreNoContribution(value: unknown): unknown {
  if (
    !isObject(value) ||
    value.arrangement !== "unknown" ||
    value[NO_PENSION_CONTRIBUTION_MARKER] !== true
  ) {
    return value;
  }
  const { [NO_PENSION_CONTRIBUTION_MARKER]: _marker, ...contribution } = value;
  return { ...contribution, arrangement: "none" };
}

function restoreStorageCompatibility(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.salaryHistory)) return value;
  return {
    ...value,
    salaryHistory: value.salaryHistory.map((record) =>
      isObject(record)
        ? {
            ...record,
            employeePension: restoreNoContribution(record.employeePension),
            employerPension: restoreNoContribution(record.employerPension),
          }
        : record,
    ),
  };
}

function storeNoContribution(
  contribution:
    | AssetTrackerData["salaryHistory"][number]["employeePension"]
    | undefined,
) {
  return contribution?.arrangement === "none"
    ? {
        ...contribution,
        arrangement: "unknown" as const,
        [NO_PENSION_CONTRIBUTION_MARKER]: true,
      }
    : contribution;
}

function storageCompatibleData(data: AssetTrackerData): unknown {
  return {
    ...data,
    salaryHistory: data.salaryHistory.map((record) => ({
      ...record,
      employeePension: storeNoContribution(record.employeePension),
      employerPension: storeNoContribution(record.employerPension),
    })),
  };
}

function parseStored(raw: string): AssetTrackerData {
  const parsed = AssetTrackerDataSchema.parse(
    restoreStorageCompatibility(JSON.parse(raw)),
  );
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
  const currentDate = () => todayIsoDate();
  function readStored(): AssetTrackerData | null {
    let raw: string | null;
    try {
      raw = storage.getItem(ASSET_TRACKER_STORAGE_KEY);
    } catch (cause) {
      throw new AssetTrackerStorageError("Browser storage could not be read", {
        cause,
      });
    }
    if (raw == null) return null;
    return parseStored(raw);
  }

  function write(data: AssetTrackerData): AssetTrackerData {
    const parsed = AssetTrackerDataSchema.parse(data);
    buildRepository(parsed);
    try {
      storage.setItem(
        ASSET_TRACKER_STORAGE_KEY,
        JSON.stringify(storageCompatibleData(parsed)),
      );
    } catch (cause) {
      throw new AssetTrackerStorageError(
        "Browser storage could not be written",
        {
          cause,
        },
      );
    }
    return parsed;
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
    importSalaryHistory(input) {
      return promiseFromSync(() => {
        const data = current();
        return write({
          ...data,
          salaryHistory: applyImportSalaryHistory(data.salaryHistory, input),
        });
      });
    },
    saveSalaryRecord(input) {
      return promiseFromSync(() => {
        const data = current();
        return write({
          ...data,
          salaryHistory: applySaveSalaryRecord(
            data.salaryHistory,
            input,
            `salary-${globalThis.crypto.randomUUID()}`,
            new Date().toISOString(),
          ),
        });
      });
    },
    deleteSalaryRecord(input) {
      return promiseFromSync(() => {
        const data = current();
        return write({
          ...data,
          salaryHistory: applyDeleteSalaryRecord(data.salaryHistory, input),
        });
      });
    },
    saveTaxSetup(input) {
      return promiseFromSync(() => write(applySaveTaxSetup(current(), input)));
    },
    clearIncomeHistory() {
      return promiseFromSync(() => write(applyClearIncomeHistory(current())));
    },
    addRecurringFlow(input) {
      return promiseFromSync(() =>
        write(applyAddRecurringFlow(current(), input, currentDate())),
      );
    },
    createPlanningCase(input) {
      return promiseFromSync(() =>
        write(applyCreatePlanningCase(current(), input)),
      );
    },
    addCommitment(input) {
      return promiseFromSync(() =>
        write(applyAddCommitment(current(), input, currentDate())),
      );
    },
    addCashFlowDecision(input) {
      return promiseFromSync(() =>
        write(applyAddCashFlowDecision(current(), input, currentDate())),
      );
    },
    updateCashFlowDecision(input) {
      return promiseFromSync(() =>
        write(applyUpdateCashFlowDecision(current(), input, currentDate())),
      );
    },
    setCashFlowDecisionStatus(input) {
      return promiseFromSync(() =>
        write(applySetCashFlowDecisionStatus(current(), input)),
      );
    },
    setCommitmentStatus(input) {
      return promiseFromSync(() =>
        write(applySetCommitmentStatus(current(), input)),
      );
    },
    recordActualCashFlow(input) {
      return promiseFromSync(() =>
        write(applyRecordActualCashFlow(current(), input, currentDate())),
      );
    },
    deleteFutureCashFlow(input) {
      return promiseFromSync(() =>
        write(applyDeleteFutureCashFlow(current(), input)),
      );
    },
    createForecastAssumptionSet(input) {
      return promiseFromSync(() =>
        write(
          applyCreateForecastAssumptionSet(
            current(),
            input,
            new Date().toISOString(),
          ),
        ),
      );
    },
    addForecastAssumption(input) {
      return promiseFromSync(() =>
        write(applyAddForecastAssumption(current(), input)),
      );
    },
    versionForecastAssumptionSet(input) {
      return promiseFromSync(() =>
        write(
          applyVersionForecastAssumptionSet(
            current(),
            input,
            new Date().toISOString(),
          ),
        ),
      );
    },
    deleteForecastAssumption(input) {
      return promiseFromSync(() =>
        write(applyDeleteForecastAssumption(current(), input)),
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
    setMortgageTerms(input) {
      return promiseFromSync(() =>
        write(applySetMortgageTerms(current(), input)),
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
    saveMortgageScenario(input) {
      return promiseFromSync(() =>
        write(applySaveMortgageScenario(current(), input, currentDate())),
      );
    },
    saveEmergencyFundPlan(input) {
      return promiseFromSync(() =>
        write(
          applySaveEmergencyFundPlan(
            current(),
            input,
            new Date().toISOString(),
          ),
        ),
      );
    },
    saveJobMoveScenario(input) {
      return promiseFromSync(() =>
        write(
          applySaveJobMoveScenario(current(), input, new Date().toISOString()),
        ),
      );
    },
    duplicateJobMoveScenario(input) {
      return promiseFromSync(() =>
        write(
          applyDuplicateJobMoveScenario(
            current(),
            input,
            new Date().toISOString(),
          ),
        ),
      );
    },
    deleteJobMoveScenario(input) {
      return promiseFromSync(() =>
        write(applyDeleteJobMoveScenario(current(), input)),
      );
    },
    addHouseholdMember(input) {
      return promiseFromSync(() =>
        write(applyAddHouseholdMember(current(), input)),
      );
    },
    renameHouseholdMember(input) {
      return promiseFromSync(() =>
        write(applyRenameHouseholdMember(current(), input)),
      );
    },
    setActiveHouseholdScope(scope) {
      return promiseFromSync(() =>
        write(applySetActiveHouseholdScope(current(), scope)),
      );
    },
    setAccountOwnership(input) {
      return promiseFromSync(() =>
        write(applySetAccountOwnership(current(), input)),
      );
    },
    importData(raw) {
      return promiseFromSync(() => {
        const data = AssetTrackerDataSchema.parse(raw);
        buildRepository(data);
        return write(data);
      });
    },
    restoreBackup(raw) {
      return promiseFromSync(() => write(parseAssetTrackerBackup(raw).data));
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
