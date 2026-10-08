import {
  type Account,
  type AccountId,
  accountLiquidity,
  isLiability,
} from "./account";
import {
  type AssetTrackerData,
  AssetTrackerDataError,
  AssetTrackerDataSchema,
} from "./assetTrackerData";
import type { BalanceSnapshot } from "./balanceSnapshot";
import { type CapitalFlow, capitalFlowKind } from "./capitalFlow";
import type { EmergencyFundPlan } from "./emergencyFund";
import type { ForecastAssumptionSet } from "./forecastAssumption";
import {
  type FutureCashFlow,
  futureCashFlowForecastItems,
  type PlanningCase,
} from "./futureCashFlow";
import { validateHouseholdOwnership } from "./household";
import type { IncomeRecord } from "./incomeRecord";
import type { JobMoveScenario } from "./jobMoveScenario";
import type {
  FinancialDecisionRecord,
  MortgageScenario,
} from "./mortgageCalculator";
import type { PlannedExpenditure } from "./plannedExpenditure";
import type { PropertyComparableSearchDefinition } from "./propertyComparables";
import type { PropertyIndexHistoryDefinition } from "./propertyIndexHistory";
import type { RecurringFlow } from "./recurringFlow";
import { compareAcceptedAt, type SalaryHistoryRecord } from "./salaryHistory";
import type { Transfer } from "./transfer";
import type {
  ExchangeRateObservation,
  HoldingObservation,
  Instrument,
  PriceObservation,
} from "./valuation";

export interface AssetTrackerRepository {
  accounts: Map<AccountId, Account>;
  snapshots: BalanceSnapshot[];
  capitalFlows: CapitalFlow[];
  incomeHistory: IncomeRecord[];
  salaryHistory: SalaryHistoryRecord[];
  jobMoveScenarios: JobMoveScenario[];
  transfers: Transfer[];
  recurringFlows: RecurringFlow[];
  plannedExpenditures: PlannedExpenditure[];
  planningCases: PlanningCase[];
  futureCashFlows: FutureCashFlow[];
  forecastAssumptionSets: ForecastAssumptionSet[];
  emergencyFundPlans: EmergencyFundPlan[];
  mortgageScenarios: MortgageScenario[];
  decisionRecords: FinancialDecisionRecord[];
  propertyComparableSearches: PropertyComparableSearchDefinition[];
  propertyIndexHistories: PropertyIndexHistoryDefinition[];
  instruments: Map<string, Instrument>;
  holdingObservations: HoldingObservation[];
  priceObservations: PriceObservation[];
  exchangeRateObservations: ExchangeRateObservation[];
  settings: AssetTrackerData["settings"];
}

/** A persisted blank slate, distinct from the demo seed. */
export function getEmptyData(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
}

function indexAccounts(accounts: Account[]): Map<AccountId, Account> {
  const byId = new Map<AccountId, Account>();
  for (const account of accounts) {
    const existing = byId.get(account.id);
    if (existing) {
      throw new AssetTrackerDataError(
        `Duplicate account ID "${account.id}": "${existing.name}" and "${account.name}" both use the same ID`,
      );
    }
    byId.set(account.id, account);
  }
  return byId;
}

function assertKnownAccount(
  accounts: ReadonlyMap<AccountId, Account>,
  accountId: AccountId | undefined,
  referrer: string,
): void {
  if (accountId != null && !accounts.has(accountId)) {
    throw new AssetTrackerDataError(
      `${referrer} references unknown account "${accountId}"`,
    );
  }
}

function assertUniqueAccountDates(
  records: ReadonlyArray<{ accountId: AccountId; date: string }>,
  label: string,
): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.accountId}\0${record.date}`;
    if (seen.has(key)) {
      throw new AssetTrackerDataError(
        `Duplicate ${label} for account "${record.accountId}" on ${record.date}`,
      );
    }
    seen.add(key);
  }
}

function assertUniqueCapitalFlows(records: readonly CapitalFlow[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.accountId}\0${record.date}\0${capitalFlowKind(record)}`;
    if (seen.has(key)) {
      const label =
        capitalFlowKind(record) === "personalSaving"
          ? "capital flow"
          : `${capitalFlowKind(record)} capital flow`;
      throw new AssetTrackerDataError(
        `Duplicate ${label} for account "${record.accountId}" on ${record.date}`,
      );
    }
    seen.add(key);
  }
}

function assertValidCorrections<
  T extends {
    id: string;
    acceptedAt: string;
    correctsId?: string;
  },
>(
  records: readonly T[],
  label: string,
  seriesKey: (record: T) => string,
): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (record.correctsId == null) continue;
    const corrected = byId.get(record.correctsId);
    if (corrected == null) {
      throw new AssetTrackerDataError(
        `${label} observation "${record.id}" corrects unknown ${label.toLowerCase()} observation "${record.correctsId}"`,
      );
    }
    if (seriesKey(record) !== seriesKey(corrected)) {
      throw new AssetTrackerDataError(
        `${label} observation "${record.id}" must correct the same series`,
      );
    }
    if (compareAcceptedAt(record.acceptedAt, corrected.acceptedAt) <= 0) {
      throw new AssetTrackerDataError(
        `${label} correction "${record.id}" must be accepted after "${record.correctsId}"`,
      );
    }
  }
}

function assertUniqueIncomeDates(incomeHistory: readonly IncomeRecord[]): void {
  const incomeDates = new Set<string>();
  for (const income of incomeHistory) {
    if (incomeDates.has(income.date)) {
      throw new AssetTrackerDataError(
        `Duplicate income record on ${income.date}`,
      );
    }
    incomeDates.add(income.date);
  }
}

function validateSalaryHistory(records: readonly SalaryHistoryRecord[]): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) {
    throw new AssetTrackerDataError("Salary history IDs must be unique");
  }
  const corrected = new Set<string>();
  for (const record of records) {
    if (record.correctsId == null) continue;
    const prior = byId.get(record.correctsId);
    if (prior == null) {
      throw new AssetTrackerDataError(
        `Salary record "${record.id}" corrects unknown record "${record.correctsId}"`,
      );
    }
    if (corrected.has(record.correctsId)) {
      throw new AssetTrackerDataError(
        `Salary record "${record.correctsId}" has more than one correction`,
      );
    }
    if (compareAcceptedAt(record.acceptedAt, prior.acceptedAt) <= 0) {
      throw new AssetTrackerDataError(
        `Salary correction "${record.id}" must be accepted after "${record.correctsId}"`,
      );
    }
    corrected.add(record.correctsId);
  }
}

function validateRecurringFlowReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  for (const flow of data.recurringFlows) {
    assertKnownAccount(
      accounts,
      flow.fromAccountId,
      `Recurring flow "${flow.name}"`,
    );
    assertKnownAccount(
      accounts,
      flow.toAccountId,
      `Recurring flow "${flow.name}"`,
    );
    const source =
      flow.fromAccountId == null ? null : accounts.get(flow.fromAccountId);
    const destination =
      flow.toAccountId == null ? null : accounts.get(flow.toAccountId);
    if (source != null && flow.currency !== source.currency) {
      throw new AssetTrackerDataError(
        `Recurring flow "${flow.name}" must use its source account currency`,
      );
    }
    const needsConversion =
      destination != null && flow.currency !== destination.currency;
    if (needsConversion && flow.conversion == null) {
      throw new AssetTrackerDataError(
        `Recurring flow "${flow.name}" needs a currency conversion`,
      );
    }
    if (
      flow.conversion != null &&
      flow.conversion.received.currency !== destination?.currency
    ) {
      throw new AssetTrackerDataError(
        `Recurring flow "${flow.name}" must receive the destination account currency`,
      );
    }
  }
}

function validateCoreReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  assertUniqueAccountDates(data.snapshots, "snapshot");
  assertUniqueCapitalFlows(data.capitalFlows);
  assertUniqueIncomeDates(data.incomeHistory);
  validateSalaryHistory(data.salaryHistory);
  for (const account of data.accounts) {
    assertKnownAccount(
      accounts,
      account.linkedAccountId,
      `Account "${account.id}"`,
    );
  }
  for (const snapshot of data.snapshots) {
    assertKnownAccount(
      accounts,
      snapshot.accountId,
      `Snapshot on date ${snapshot.date}`,
    );
  }
  for (const capitalFlow of data.capitalFlows) {
    assertKnownAccount(
      accounts,
      capitalFlow.accountId,
      `Capital flow on date ${capitalFlow.date}`,
    );
  }
  for (const transfer of data.transfers) {
    assertKnownAccount(
      accounts,
      transfer.fromAccountId,
      `Transfer "${transfer.id}"`,
    );
    assertKnownAccount(
      accounts,
      transfer.toAccountId,
      `Transfer "${transfer.id}"`,
    );
  }
  validateRecurringFlowReferences(data, accounts);
}

function validatePlannedExpenditureReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  for (const expenditure of data.plannedExpenditures) {
    assertKnownAccount(
      accounts,
      expenditure.fromAccountId,
      `Planned expenditure "${expenditure.name}"`,
    );
    const source = accounts.get(expenditure.fromAccountId);
    if (
      source != null &&
      (source.closedAt != null ||
        isLiability(source.assetType) ||
        accountLiquidity(source) === "illiquid")
    ) {
      throw new AssetTrackerDataError(
        `Planned expenditure "${expenditure.name}" references ineligible account "${expenditure.fromAccountId}"`,
      );
    }
  }
}

function indexPlanningCases(data: AssetTrackerData): Set<string> {
  const ids = new Set<string>();
  for (const planningCase of data.planningCases) {
    if (ids.has(planningCase.id)) {
      throw new AssetTrackerDataError(
        `Duplicate planning case ID "${planningCase.id}"`,
      );
    }
    ids.add(planningCase.id);
  }
  return ids;
}

function validateFutureCashFlowStages(
  record: FutureCashFlow,
  accounts: Map<AccountId, Account>,
): void {
  const stageIds = new Set<string>();
  const actualIds = new Set<string>();
  for (const stage of record.stages) {
    assertKnownAccount(
      accounts,
      stage.fromAccountId,
      `Future cash flow "${record.name}"`,
    );
    if (accounts.get(stage.fromAccountId)?.currency !== record.currency) {
      throw new AssetTrackerDataError(
        `Future cash flow "${record.name}" must use the currency of account "${stage.fromAccountId}"`,
      );
    }
    if (stageIds.has(stage.id)) {
      throw new AssetTrackerDataError(
        `Future cash flow "${record.name}" has duplicate stage ID "${stage.id}"`,
      );
    }
    stageIds.add(stage.id);
    for (const actual of stage.actuals) {
      if (actualIds.has(actual.id)) {
        throw new AssetTrackerDataError(
          `Future cash flow "${record.name}" has duplicate actual cash flow ID "${actual.id}"`,
        );
      }
      actualIds.add(actual.id);
    }
  }
}

function indexFutureCashFlows(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
  planningCaseIds: ReadonlySet<string>,
): Map<string, FutureCashFlow> {
  const records = new Map<string, FutureCashFlow>();
  for (const record of data.futureCashFlows) {
    if (records.has(record.id)) {
      throw new AssetTrackerDataError(
        `Duplicate future cash flow ID "${record.id}"`,
      );
    }
    records.set(record.id, record);
    if (
      record.planningCaseId != null &&
      !planningCaseIds.has(record.planningCaseId)
    ) {
      throw new AssetTrackerDataError(
        `Future cash flow "${record.name}" references unknown planning case "${record.planningCaseId}"`,
      );
    }
    validateFutureCashFlowStages(record, accounts);
  }
  return records;
}

function validateDecisionReferences(
  records: ReadonlyMap<string, FutureCashFlow>,
): void {
  for (const record of records.values()) {
    if (record.kind !== "decision") continue;
    validateDecisionReferenceList(record, records, record.dependencyIds);
    validateDecisionReferenceList(record, records, record.alternativeToIds);
  }
}

function validateDecisionReferenceList(
  record: FutureCashFlow & { kind: "decision" },
  records: ReadonlyMap<string, FutureCashFlow>,
  referencedIds: readonly string[],
): void {
  for (const referencedId of referencedIds) {
    if (referencedId === record.id) {
      throw new AssetTrackerDataError(
        `Decision "${record.name}" cannot reference itself`,
      );
    }
    if (!records.has(referencedId)) {
      throw new AssetTrackerDataError(
        `Decision "${record.name}" references unknown future cash flow "${referencedId}"`,
      );
    }
  }
}

function validateForecastAccounts(
  records: readonly FutureCashFlow[],
  accounts: ReadonlyMap<AccountId, Account>,
): void {
  for (const forecast of futureCashFlowForecastItems(records)) {
    const source = accounts.get(forecast.fromAccountId);
    if (
      source != null &&
      (source.closedAt != null ||
        isLiability(source.assetType) ||
        accountLiquidity(source) === "illiquid")
    ) {
      throw new AssetTrackerDataError(
        `Future cash flow "${forecast.name}" references ineligible account "${forecast.fromAccountId}"`,
      );
    }
  }
}

function validateFutureCashFlowReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  const planningCaseIds = indexPlanningCases(data);
  const records = indexFutureCashFlows(data, accounts, planningCaseIds);
  validateDecisionReferences(records);
  validateForecastAccounts(data.futureCashFlows, accounts);
}

function validateForecastAssumptions(
  set: ForecastAssumptionSet,
  accounts: ReadonlyMap<AccountId, Account>,
  assumptionIds: Set<string>,
): void {
  for (const assumption of set.assumptions) {
    if (assumptionIds.has(assumption.id)) {
      throw new AssetTrackerDataError(
        `Duplicate forecast assumption ID "${assumption.id}"`,
      );
    }
    assumptionIds.add(assumption.id);
    assertKnownAccount(
      accounts,
      assumption.accountId,
      `Forecast assumption "${assumption.name}"`,
    );
    if (
      assumption.accountId != null &&
      accounts.get(assumption.accountId)?.currency !== assumption.currency
    ) {
      throw new AssetTrackerDataError(
        `Forecast assumption "${assumption.name}" must use the currency of account "${assumption.accountId}"`,
      );
    }
  }
}

function validateForecastAssumptionSets(
  data: AssetTrackerData,
  accounts: ReadonlyMap<AccountId, Account>,
): void {
  const ids = new Set<string>();
  const activeSeries = new Set<string>();
  const assumptionIds = new Set<string>();
  for (const set of data.forecastAssumptionSets) {
    if (ids.has(set.id)) {
      throw new AssetTrackerDataError(
        `Duplicate forecast assumption set ID "${set.id}"`,
      );
    }
    ids.add(set.id);
    if (set.status === "active") {
      if (activeSeries.has(set.seriesId)) {
        throw new AssetTrackerDataError(
          `Forecast assumption series "${set.seriesId}" has more than one active version`,
        );
      }
      activeSeries.add(set.seriesId);
    }
    validateForecastAssumptions(set, accounts, assumptionIds);
    if (
      set.supersedesId != null &&
      !data.forecastAssumptionSets.some(({ id }) => id === set.supersedesId)
    ) {
      throw new AssetTrackerDataError(
        `Forecast assumption set "${set.name}" supersedes unknown version "${set.supersedesId}"`,
      );
    }
  }
}

function validateEmergencyFundPlans(
  data: AssetTrackerData,
  accounts: ReadonlyMap<AccountId, Account>,
): void {
  const ids = new Set<string>();
  const activeSeries = new Set<string>();
  const plans = data.emergencyFundPlans ?? [];
  for (const plan of plans) {
    if (ids.has(plan.id)) {
      throw new AssetTrackerDataError(
        `Duplicate emergency-fund plan ID "${plan.id}"`,
      );
    }
    ids.add(plan.id);
    if (plan.status === "active") {
      if (activeSeries.has(plan.seriesId)) {
        throw new AssetTrackerDataError(
          `Emergency-fund plan series "${plan.seriesId}" has more than one active version`,
        );
      }
      activeSeries.add(plan.seriesId);
    }
    for (const policy of plan.accountPolicies) {
      assertKnownAccount(
        accounts,
        policy.accountId,
        `Emergency-fund plan "${plan.name}"`,
      );
    }
    if (
      plan.supersedesId != null &&
      !plans.some(({ id }) => id === plan.supersedesId)
    ) {
      throw new AssetTrackerDataError(
        `Emergency-fund plan "${plan.name}" supersedes unknown version "${plan.supersedesId}"`,
      );
    }
  }
}

function indexInstruments(data: AssetTrackerData): Map<string, Instrument> {
  const instruments = new Map(
    (data.instruments ?? []).map((instrument) => [instrument.id, instrument]),
  );
  if (instruments.size !== (data.instruments ?? []).length) {
    throw new AssetTrackerDataError("Instrument IDs must be unique");
  }
  return instruments;
}

function assertUniqueObservationIds(data: AssetTrackerData): void {
  const observationIds = new Set<string>();
  const observations = [
    ...(data.holdingObservations ?? []),
    ...(data.priceObservations ?? []),
    ...(data.exchangeRateObservations ?? []),
  ];
  for (const observation of observations) {
    if (observationIds.has(observation.id)) {
      throw new AssetTrackerDataError(
        `Duplicate observation ID "${observation.id}"`,
      );
    }
    observationIds.add(observation.id);
  }
}

function validateInstrumentReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
  instruments: ReadonlyMap<string, Instrument>,
): void {
  for (const observation of data.holdingObservations ?? []) {
    assertKnownAccount(
      accounts,
      observation.accountId,
      `Holding observation "${observation.id}"`,
    );
    if (!instruments.has(observation.instrumentId)) {
      throw new AssetTrackerDataError(
        `Holding observation "${observation.id}" references unknown instrument "${observation.instrumentId}"`,
      );
    }
  }
  for (const observation of data.priceObservations ?? []) {
    if (!instruments.has(observation.instrumentId)) {
      throw new AssetTrackerDataError(
        `Price observation "${observation.id}" references unknown instrument "${observation.instrumentId}"`,
      );
    }
  }
}

function validateValuationReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  const instruments = indexInstruments(data);
  assertUniqueObservationIds(data);
  validateInstrumentReferences(data, accounts, instruments);
  assertValidCorrections(
    data.holdingObservations ?? [],
    "Holding",
    (record) => `${record.accountId}\0${record.instrumentId}`,
  );
  assertValidCorrections(
    data.priceObservations ?? [],
    "Price",
    (record) => record.instrumentId,
  );
  assertValidCorrections(
    data.exchangeRateObservations ?? [],
    "Exchange-rate",
    (record) => `${record.fromCurrency}\0${record.toCurrency}`,
  );
}

function validatePropertyIndexHistoryReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  const propertyHistoryAccounts = new Set<string>();
  for (const history of data.propertyIndexHistories ?? []) {
    assertKnownAccount(
      accounts,
      history.accountId,
      `Property index history for account "${history.accountId}"`,
    );
    const account = accounts.get(history.accountId);
    if (account != null && account.assetType !== "property") {
      throw new AssetTrackerDataError(
        `Property index history references non-property account "${history.accountId}"`,
      );
    }
    if (propertyHistoryAccounts.has(history.accountId)) {
      throw new AssetTrackerDataError(
        `Duplicate property index history for account "${history.accountId}"`,
      );
    }
    propertyHistoryAccounts.add(history.accountId);
  }
}

function validatePropertyComparableSearchReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  const comparableSearchAccounts = new Set<string>();
  for (const search of data.propertyComparableSearches ?? []) {
    assertKnownAccount(
      accounts,
      search.accountId,
      `Property comparable search for account "${search.accountId}"`,
    );
    const account = accounts.get(search.accountId);
    if (account != null && account.assetType !== "property") {
      throw new AssetTrackerDataError(
        `Property comparable search references non-property account "${search.accountId}"`,
      );
    }
    if (comparableSearchAccounts.has(search.accountId)) {
      throw new AssetTrackerDataError(
        `Duplicate property comparable search for account "${search.accountId}"`,
      );
    }
    comparableSearchAccounts.add(search.accountId);
  }
}

function validateJobMoveScenarioReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  const recurringFlowIds = new Set(data.recurringFlows.map(({ id }) => id));
  const scenarioIds = new Set<string>();
  for (const scenario of data.jobMoveScenarios ?? []) {
    if (scenarioIds.has(scenario.id)) {
      throw new AssetTrackerDataError(
        `Duplicate job-move scenario ID "${scenario.id}"`,
      );
    }
    scenarioIds.add(scenario.id);
    assertKnownAccount(
      accounts,
      scenario.destinationAccountId,
      `Job-move scenario "${scenario.name}"`,
    );
    assertKnownAccount(
      accounts,
      scenario.pensionAccountId,
      `Job-move scenario "${scenario.name}"`,
    );
    for (const flowId of scenario.replacedRecurringFlowIds) {
      if (!recurringFlowIds.has(flowId)) {
        throw new AssetTrackerDataError(
          `Job-move scenario "${scenario.name}" replaces unknown recurring flow "${flowId}"`,
        );
      }
    }
  }
}

function validateReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  validateCoreReferences(data, accounts);
  validatePlannedExpenditureReferences(data, accounts);
  validateFutureCashFlowReferences(data, accounts);
  validateForecastAssumptionSets(data, accounts);
  validateEmergencyFundPlans(data, accounts);
  validateValuationReferences(data, accounts);
  validatePropertyComparableSearchReferences(data, accounts);
  validatePropertyIndexHistoryReferences(data, accounts);
  validateJobMoveScenarioReferences(data, accounts);
  const mortgageScenarios = data.mortgageScenarios ?? [];
  const decisionRecords = data.decisionRecords ?? [];
  const scenarios = new Map(
    mortgageScenarios.map((scenario) => [scenario.id, scenario]),
  );
  if (scenarios.size !== mortgageScenarios.length) {
    throw new AssetTrackerDataError("Mortgage scenario IDs must be unique");
  }
  const decisions = new Map(
    decisionRecords.map((decision) => [decision.id, decision]),
  );
  if (decisions.size !== decisionRecords.length) {
    throw new AssetTrackerDataError("Decision record IDs must be unique");
  }
  for (const scenario of mortgageScenarios) {
    assertKnownAccount(
      accounts,
      scenario.source.mortgageAccountId,
      `Mortgage scenario "${scenario.name}"`,
    );
    assertKnownAccount(
      accounts,
      scenario.source.propertyAccountId,
      `Mortgage scenario "${scenario.name}"`,
    );
    if (
      scenario.decisionRecordId != null &&
      !decisions.has(scenario.decisionRecordId)
    ) {
      throw new AssetTrackerDataError(
        `Mortgage scenario "${scenario.name}" references unknown decision "${scenario.decisionRecordId}"`,
      );
    }
  }
  for (const decision of decisionRecords) {
    if (!scenarios.has(decision.scenarioId)) {
      throw new AssetTrackerDataError(
        `Decision "${decision.title}" references unknown mortgage scenario "${decision.scenarioId}"`,
      );
    }
  }
}

export function buildRepository(
  data: AssetTrackerData,
): AssetTrackerRepository {
  validateHouseholdOwnership(data);
  const accounts = indexAccounts(data.accounts);
  validateReferences(data, accounts);
  const snapshots = [...data.snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const capitalFlows = [...data.capitalFlows].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return {
    accounts,
    snapshots,
    capitalFlows,
    incomeHistory: [...data.incomeHistory].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    salaryHistory: [...data.salaryHistory].sort((a, b) =>
      compareAcceptedAt(a.acceptedAt, b.acceptedAt),
    ),
    jobMoveScenarios: [...(data.jobMoveScenarios ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    transfers: data.transfers,
    recurringFlows: data.recurringFlows,
    plannedExpenditures: [...data.plannedExpenditures].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    planningCases: [...data.planningCases].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    futureCashFlows: [...data.futureCashFlows].sort((a, b) => {
      const aDate = futureCashFlowForecastItems([a])[0]?.date ?? "9999-12-31";
      const bDate = futureCashFlowForecastItems([b])[0]?.date ?? "9999-12-31";
      return aDate.localeCompare(bDate) || a.name.localeCompare(b.name);
    }),
    forecastAssumptionSets: [...data.forecastAssumptionSets].sort(
      (a, b) => a.name.localeCompare(b.name) || b.version - a.version,
    ),
    emergencyFundPlans: [...(data.emergencyFundPlans ?? [])].sort(
      (a, b) => b.version - a.version,
    ),
    mortgageScenarios: data.mortgageScenarios ?? [],
    decisionRecords: data.decisionRecords ?? [],
    propertyComparableSearches: data.propertyComparableSearches ?? [],
    propertyIndexHistories: data.propertyIndexHistories ?? [],
    instruments: new Map(
      (data.instruments ?? []).map((instrument) => [instrument.id, instrument]),
    ),
    holdingObservations: [...(data.holdingObservations ?? [])],
    priceObservations: [...(data.priceObservations ?? [])],
    exchangeRateObservations: [...(data.exchangeRateObservations ?? [])],
    settings: data.settings,
  };
}
