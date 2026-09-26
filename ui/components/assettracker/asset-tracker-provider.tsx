"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AssetTrackerApi,
  createLocalAssetTrackerApi,
} from "@/lib/api/assettracker";
import {
  type AccountDetailView,
  type AccountId,
  type AccountSummaryView,
  type AddPlannedExpenditureInput,
  type AddRecurringFlowInput,
  type AssetAllocationDataPoint,
  type AssetTrackerData,
  type AssetType,
  buildBaseCurrencyFlowSankeyData,
  buildRepository,
  type ClearAccountHistoryInput,
  type CreateAccountInput,
  type Currency,
  type DeleteCapitalFlowInput,
  type DeleteSnapshotInput,
  type FlowSankeyData,
  getAllAccountDetails,
  getAllAccountSummaries,
  getAssetAllocationTimeSeries,
  getLatestPortfolioValuation,
  getNetWorthTimeSeries,
  getPortfolioAnnualReturn,
  getPortfolioContributionTimeSeries,
  getPortfolioFinancialIndependence,
  getSeedData,
  getTotalByAssetType,
  type ImportAccountHistoryInput,
  type ImportIncomeHistoryInput,
  type IncomeRecord,
  type Money,
  type NetWorthDataPoint,
  type PlannedExpenditure,
  type PortfolioContributionDataPoint,
  type PortfolioFinancialIndependence,
  type RecordBalanceInput,
  type RecordTransferInput,
  type RecurringFlow,
  type SetAccountLiquidityInput,
  type SetExpectedReturnInput,
  type Transfer,
  toBalancesCsv,
  todayIsoDate,
  type ValuationIssue,
} from "@/lib/domain/assettracker";

interface AssetTrackerContextValue {
  accounts: AccountSummaryView[];
  accountDetails: AccountDetailView[];
  netWorthData: NetWorthDataPoint[];
  contributionData: PortfolioContributionDataPoint[];
  assetAllocation: { assetType: AssetType; total: number }[];
  assetAllocationHistory: AssetAllocationDataPoint[];
  transfers: Transfer[];
  recurringFlows: RecurringFlow[];
  plannedExpenditures: PlannedExpenditure[];
  incomeHistory: IncomeRecord[];
  flowSankeyData: FlowSankeyData;
  financialIndependence: PortfolioFinancialIndependence;
  /** Annualised portfolio growth, excluding recorded external money in/out */
  portfolioReturn: number | null;
  /** Expected annual inflation used to express values in today's money */
  inflation: number;
  /** The net worth the user is aiming for, if set */
  netWorthTarget: Money | null;
  /** Whether the target is expressed in today's money (inflation-adjusted) */
  netWorthTargetIsReal: boolean;
  /** Sustainable annual withdrawal used to derive the FI target */
  withdrawalRate: number;
  /** Currency used for every household-level value. */
  baseCurrency: Currency;
  valuationDate: string | null;
  valuationIssues: ValuationIssue[];
  /** True once the user has made changes that are persisted in this browser */
  hasLocalChanges: boolean;
  createAccount(input: CreateAccountInput): Promise<void>;
  recordBalance(input: RecordBalanceInput): Promise<void>;
  recordTransfer(input: RecordTransferInput): Promise<void>;
  closeAccount(
    accountId: AccountId,
    transferToAccountId?: AccountId,
  ): Promise<void>;
  clearAccountHistory(input: ClearAccountHistoryInput): Promise<void>;
  deleteSnapshot(input: DeleteSnapshotInput): Promise<void>;
  deleteCapitalFlow(input: DeleteCapitalFlowInput): Promise<void>;
  importAccountHistory(input: ImportAccountHistoryInput): Promise<void>;
  importIncomeHistory(input: ImportIncomeHistoryInput): Promise<void>;
  clearIncomeHistory(): Promise<void>;
  addRecurringFlow(input: AddRecurringFlowInput): Promise<void>;
  addPlannedExpenditure(input: AddPlannedExpenditureInput): Promise<void>;
  deleteRecurringFlow(id: string): Promise<void>;
  deletePlannedExpenditure(id: string): Promise<void>;
  materializeFlow(flowId: string): Promise<void>;
  setExpectedReturn(input: SetExpectedReturnInput): Promise<void>;
  setAccountLiquidity(input: SetAccountLiquidityInput): Promise<void>;
  setInflation(rate: number): Promise<void>;
  setBaseCurrency(currency: Currency): Promise<void>;
  setWithdrawalRate(rate: number): Promise<void>;
  setNetWorthTarget(
    target: number | null,
    inTodaysMoney?: boolean,
  ): Promise<void>;
  clearData(): Promise<void>;
  resetData(): Promise<void>;
  exportData(): void;
  exportCsv(): void;
  importData(file: File): Promise<void>;
}

const AssetTrackerContext = createContext<AssetTrackerContextValue | null>(
  null,
);

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AssetTrackerProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Seed synchronously so the static build renders the full demo dashboard;
  // locally saved changes are applied after mount to avoid hydration mismatch
  const [data, setData] = useState<AssetTrackerData>(getSeedData);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const apiRef = useRef<AssetTrackerApi | null>(null);
  // Once the user has mutated, a late-resolving load() must not clobber the
  // fresher state with the older persisted snapshot
  const hasMutatedRef = useRef(false);

  const getApi = useCallback(() => {
    apiRef.current ??= createLocalAssetTrackerApi(window.localStorage);
    return apiRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .load()
      .then(({ data: stored, persisted }) => {
        if (cancelled || hasMutatedRef.current || !persisted) return;
        setData(stored);
        setHasLocalChanges(true);
      })
      .catch((err) => {
        console.warn("AssetTracker: failed to load stored data", err);
      });
    return () => {
      cancelled = true;
    };
  }, [getApi]);

  const mutate = useCallback(
    async (run: (api: AssetTrackerApi) => Promise<AssetTrackerData>) => {
      hasMutatedRef.current = true;
      const next = await run(getApi());
      setData(next);
      setHasLocalChanges(true);
    },
    [getApi],
  );

  const views = useMemo(() => {
    const repository = buildRepository(data);
    const accounts = getAllAccountSummaries(repository);
    const netWorthData = getNetWorthTimeSeries(repository);
    const latestValuation = getLatestPortfolioValuation(repository);
    const accountDetails = getAllAccountDetails(repository);
    const valuationDate = latestValuation?.date ?? todayIsoDate();
    return {
      accounts,
      accountDetails,
      netWorthData,
      contributionData: getPortfolioContributionTimeSeries(repository),
      assetAllocation: getTotalByAssetType(repository),
      assetAllocationHistory: getAssetAllocationTimeSeries(repository),
      transfers: repository.transfers,
      recurringFlows: repository.recurringFlows,
      plannedExpenditures: repository.plannedExpenditures,
      incomeHistory: repository.incomeHistory,
      flowSankeyData: buildBaseCurrencyFlowSankeyData(
        repository,
        accountDetails,
        valuationDate,
      ),
      financialIndependence: getPortfolioFinancialIndependence(repository),
      portfolioReturn: getPortfolioAnnualReturn(repository),
      inflation: repository.settings.expectedAnnualInflation,
      netWorthTarget: repository.settings.targetNetWorth ?? null,
      netWorthTargetIsReal: repository.settings.targetNetWorthIsReal ?? false,
      withdrawalRate: repository.settings.withdrawalRate,
      baseCurrency: repository.settings.baseCurrency,
      valuationDate: latestValuation?.date ?? null,
      valuationIssues: latestValuation?.issues ?? [],
    };
  }, [data]);

  const value = useMemo<AssetTrackerContextValue>(
    () => ({
      ...views,
      hasLocalChanges,
      createAccount: (input) => mutate((api) => api.createAccount(input)),
      recordBalance: (input) => mutate((api) => api.recordBalance(input)),
      recordTransfer: (input) => mutate((api) => api.recordTransfer(input)),
      closeAccount: (accountId, transferToAccountId) =>
        mutate((api) =>
          api.closeAccount({
            accountId,
            closedAt: todayIsoDate(),
            transferToAccountId,
          }),
        ),
      clearAccountHistory: (input) =>
        mutate((api) => api.clearAccountHistory(input)),
      deleteSnapshot: (input) => mutate((api) => api.deleteSnapshot(input)),
      deleteCapitalFlow: (input) =>
        mutate((api) => api.deleteCapitalFlow(input)),
      importAccountHistory: (input) =>
        mutate((api) => api.importAccountHistory(input)),
      importIncomeHistory: (input) =>
        mutate((api) => api.importIncomeHistory(input)),
      clearIncomeHistory: () => mutate((api) => api.clearIncomeHistory()),
      addRecurringFlow: (input) => mutate((api) => api.addRecurringFlow(input)),
      addPlannedExpenditure: (input) =>
        mutate((api) => api.addPlannedExpenditure(input)),
      deleteRecurringFlow: (id) =>
        mutate((api) => api.deleteRecurringFlow({ id })),
      deletePlannedExpenditure: (id) =>
        mutate((api) => api.deletePlannedExpenditure({ id })),
      materializeFlow: (flowId) =>
        mutate((api) =>
          api.materializeFlow({ flowId, throughDate: todayIsoDate() }),
        ),
      setExpectedReturn: (input) =>
        mutate((api) => api.setExpectedReturn(input)),
      setAccountLiquidity: (input) =>
        mutate((api) => api.setAccountLiquidity(input)),
      setInflation: (rate) => mutate((api) => api.setInflation({ rate })),
      setBaseCurrency: (currency) =>
        mutate((api) => api.setBaseCurrency({ currency })),
      setWithdrawalRate: (rate) =>
        mutate((api) => api.setWithdrawalRate({ rate })),
      setNetWorthTarget: (target, inTodaysMoney) =>
        mutate((api) => api.setNetWorthTarget({ target, inTodaysMoney })),
      clearData: () => mutate((api) => api.clear()),
      resetData: async () => {
        const seed = await getApi().reset();
        setData(seed);
        setHasLocalChanges(false);
      },
      exportData: () =>
        downloadFile(
          `assettracker-${todayIsoDate()}.json`,
          JSON.stringify(data, null, 2),
          "application/json",
        ),
      exportCsv: () =>
        downloadFile(
          `assettracker-balances-${todayIsoDate()}.csv`,
          toBalancesCsv(data),
          "text/csv",
        ),
      importData: async (file) => {
        const raw = JSON.parse(await file.text());
        await mutate((api) => api.importData(raw));
      },
    }),
    [views, hasLocalChanges, data, mutate, getApi],
  );

  return (
    <AssetTrackerContext.Provider value={value}>
      {children}
    </AssetTrackerContext.Provider>
  );
}

export function useAssetTracker(): AssetTrackerContextValue {
  const context = useContext(AssetTrackerContext);
  if (!context) {
    throw new Error(
      "useAssetTracker must be used within an AssetTrackerProvider",
    );
  }
  return context;
}
