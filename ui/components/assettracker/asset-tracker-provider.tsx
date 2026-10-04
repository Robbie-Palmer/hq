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
import { housePriceIndexArchive } from "@/content/assettracker/propertyIndexHistory";
import {
  type AssetTrackerApi,
  createLocalAssetTrackerApi,
} from "@/lib/api/assettracker";
import {
  buildBaseCurrencyFlowSankeyData,
  type FlowSankeyData,
  getDemoAssetTrackerData,
  toBalancesCsv,
  todayIsoDate,
} from "@/lib/assettracker";
import {
  type AccountDetailView,
  type AccountId,
  type AccountSummaryView,
  type AddPlannedExpenditureInput,
  type AddRecurringFlowInput,
  type AssetAllocationDataPoint,
  type AssetTrackerData,
  type AssetType,
  buildAccountReadModels,
  buildPropertyValueHistoryViews,
  buildRepository,
  type ClearAccountHistoryInput,
  type CreateAccountInput,
  type Currency,
  type DeleteCapitalFlowInput,
  type DeleteSnapshotInput,
  type FinancialDecisionRecord,
  getAssetAllocationTimeSeries,
  getHousingPlanningPosition,
  getLatestPortfolioValuation,
  getNetWorthTimeSeries,
  getPortfolioAnnualReturn,
  getPortfolioContributionTimeSeries,
  getPortfolioFinancialIndependence,
  getPortfolioPositionSummary,
  getTotalByAssetType,
  type Household,
  type HouseholdScope,
  type HousingPlanningPosition,
  type ImportAccountHistoryInput,
  type ImportIncomeHistoryInput,
  type IncomeRecord,
  type Money,
  type MortgageScenario,
  type NetWorthDataPoint,
  type Ownership,
  type PlannedExpenditure,
  type PortfolioContributionDataPoint,
  type PortfolioFinancialIndependence,
  type PortfolioPositionSummary,
  type PropertyValueHistoryView,
  personalOwnership,
  type RecordBalanceInput,
  type RecordTransferInput,
  type RecurringFlow,
  type SaveMortgageScenarioInput,
  type SetAccountLiquidityInput,
  type SetExpectedReturnInput,
  SUPPORTED_CURRENCIES,
  scopeAssetTrackerData,
  type Transfer,
  type ValuationIssue,
} from "@/lib/domain/assettracker";

interface AssetTrackerContextValue {
  accounts: AccountSummaryView[];
  accountDetails: AccountDetailView[];
  netWorthData: NetWorthDataPoint[];
  netWorthDataByCurrency: Record<Currency, NetWorthDataPoint[]>;
  contributionData: PortfolioContributionDataPoint[];
  assetAllocation: { assetType: AssetType; total: number }[];
  assetAllocationHistory: AssetAllocationDataPoint[];
  transfers: Transfer[];
  recurringFlows: RecurringFlow[];
  plannedExpenditures: PlannedExpenditure[];
  mortgageScenarios: MortgageScenario[];
  decisionRecords: FinancialDecisionRecord[];
  incomeHistory: IncomeRecord[];
  flowSankeyData: FlowSankeyData;
  financialIndependence: PortfolioFinancialIndependence;
  housingPlanningPosition: HousingPlanningPosition | null;
  /** Annualised portfolio growth, excluding recorded external money in/out */
  portfolioReturn: number | null;
  positionSummary: PortfolioPositionSummary | null;
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
  propertyValueHistories: PropertyValueHistoryView[];
  household: Household;
  householdAccounts: Array<{
    id: string;
    name: string;
    provider: string;
    ownership: Ownership;
  }>;
  /** True once the user has made changes that are persisted in this browser */
  hasLocalChanges: boolean;
  localDataStatus: "loading" | "ready" | "error";
  localDataError: string | null;
  retryLocalData(): void;
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
  saveMortgageScenario(input: SaveMortgageScenarioInput): Promise<void>;
  setNetWorthTarget(
    target: number | null,
    inTodaysMoney?: boolean,
  ): Promise<void>;
  addHouseholdMember(displayName: string): Promise<void>;
  renameHouseholdMember(memberId: string, displayName: string): Promise<void>;
  setActiveHouseholdScope(scope: HouseholdScope): Promise<void>;
  setAccountOwnership(accountId: string, ownership: Ownership): Promise<void>;
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
  const [data, setData] = useState<AssetTrackerData>(getDemoAssetTrackerData);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [localDataStatus, setLocalDataStatus] =
    useState<AssetTrackerContextValue["localDataStatus"]>("loading");
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const apiRef = useRef<AssetTrackerApi | null>(null);
  // Once the user has mutated, a late-resolving load() must not clobber the
  // fresher state with the older persisted snapshot
  const hasMutatedRef = useRef(false);
  const loadRequestRef = useRef(0);

  const getApi = useCallback(() => {
    apiRef.current ??= createLocalAssetTrackerApi(window.localStorage);
    return apiRef.current;
  }, []);

  const loadLocalData = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLocalDataStatus("loading");
    setLocalDataError(null);
    try {
      const { data: stored, persisted } = await getApi().load();
      if (request !== loadRequestRef.current) return;
      if (!hasMutatedRef.current && persisted) {
        setData(stored);
        setHasLocalChanges(true);
      }
      setLocalDataStatus("ready");
    } catch (error) {
      if (request !== loadRequestRef.current) return;
      console.warn("AssetTracker: failed to load stored data", error);
      setLocalDataStatus("error");
      setLocalDataError(
        "Asset Tracker could not read this browser's saved data. Nothing has been changed. Check that browser storage is available, then try again.",
      );
    }
  }, [getApi]);

  useEffect(() => {
    void loadLocalData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadLocalData]);

  const mutate = useCallback(
    async (run: (api: AssetTrackerApi) => Promise<AssetTrackerData>) => {
      hasMutatedRef.current = true;
      try {
        const next = await run(getApi());
        setData(next);
        setHasLocalChanges(true);
        setLocalDataStatus("ready");
        setLocalDataError(null);
      } catch (error) {
        setLocalDataStatus("error");
        setLocalDataError(
          "Asset Tracker could not save the last change in this browser. The change was not applied. Check that browser storage is available, then try again.",
        );
        throw error;
      }
    },
    [getApi],
  );

  const views = useMemo(() => {
    const scopedData = scopeAssetTrackerData(data);
    const repository = buildRepository(scopedData);
    const { summaries: accounts, details: accountDetails } =
      buildAccountReadModels(repository);
    const netWorthDataByCurrency = Object.fromEntries(
      SUPPORTED_CURRENCIES.map((currency) => [
        currency,
        getNetWorthTimeSeries({
          ...repository,
          settings: { ...repository.settings, baseCurrency: currency },
        }),
      ]),
    ) as Record<Currency, NetWorthDataPoint[]>;
    const netWorthData =
      netWorthDataByCurrency[repository.settings.baseCurrency];
    const latestValuation = getLatestPortfolioValuation(repository);
    const valuationDate = latestValuation?.date ?? todayIsoDate();
    const financialIndependence = getPortfolioFinancialIndependence(
      repository,
      valuationDate,
    );
    return {
      accounts,
      accountDetails,
      netWorthData,
      netWorthDataByCurrency,
      contributionData: getPortfolioContributionTimeSeries(repository),
      assetAllocation: getTotalByAssetType(repository),
      assetAllocationHistory: getAssetAllocationTimeSeries(repository),
      transfers: repository.transfers,
      recurringFlows: repository.recurringFlows,
      plannedExpenditures: repository.plannedExpenditures,
      mortgageScenarios: repository.mortgageScenarios,
      decisionRecords: repository.decisionRecords,
      incomeHistory: repository.incomeHistory,
      flowSankeyData: buildBaseCurrencyFlowSankeyData(
        repository,
        accountDetails,
        valuationDate,
      ),
      financialIndependence,
      housingPlanningPosition: getHousingPlanningPosition(
        repository,
        financialIndependence,
        valuationDate,
      ),
      portfolioReturn: getPortfolioAnnualReturn(repository),
      positionSummary: getPortfolioPositionSummary(repository),
      inflation: repository.settings.expectedAnnualInflation,
      netWorthTarget: repository.settings.targetNetWorth ?? null,
      netWorthTargetIsReal: repository.settings.targetNetWorthIsReal ?? false,
      withdrawalRate: repository.settings.withdrawalRate,
      baseCurrency: repository.settings.baseCurrency,
      valuationDate: latestValuation?.date ?? null,
      valuationIssues: latestValuation?.issues ?? [],
      propertyValueHistories: buildPropertyValueHistoryViews(
        scopedData.propertyIndexHistories ?? [],
        housePriceIndexArchive,
      ),
      household: data.household,
      householdAccounts: data.accounts.map(({ id, name, provider }) => ({
        id,
        name,
        provider,
        ownership:
          data.ownership.accounts[id] ??
          personalOwnership(data.household.members[0]?.id ?? "primary"),
      })),
    };
  }, [data]);

  const value = useMemo<AssetTrackerContextValue>(
    () => ({
      ...views,
      hasLocalChanges,
      localDataStatus,
      localDataError,
      retryLocalData: () => {
        void loadLocalData();
      },
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
      saveMortgageScenario: (input) =>
        mutate((api) => api.saveMortgageScenario(input)),
      setNetWorthTarget: (target, inTodaysMoney) =>
        mutate((api) => api.setNetWorthTarget({ target, inTodaysMoney })),
      addHouseholdMember: (displayName) =>
        mutate((api) => api.addHouseholdMember({ displayName })),
      renameHouseholdMember: (memberId, displayName) =>
        mutate((api) => api.renameHouseholdMember({ memberId, displayName })),
      setActiveHouseholdScope: (scope) =>
        mutate((api) => api.setActiveHouseholdScope(scope)),
      setAccountOwnership: (accountId, ownership) =>
        mutate((api) => api.setAccountOwnership({ accountId, ownership })),
      clearData: () => mutate((api) => api.clear()),
      resetData: async () => {
        try {
          const seed = await getApi().reset();
          setData(seed);
          setHasLocalChanges(false);
          setLocalDataStatus("ready");
          setLocalDataError(null);
        } catch (error) {
          setLocalDataStatus("error");
          setLocalDataError(
            "Asset Tracker could not reset data in this browser. Nothing has been changed. Check that browser storage is available, then try again.",
          );
          throw error;
        }
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
    [
      views,
      hasLocalChanges,
      localDataStatus,
      localDataError,
      data,
      mutate,
      getApi,
      loadLocalData,
    ],
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
