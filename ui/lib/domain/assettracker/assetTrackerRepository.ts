import { accounts as definedAccounts } from "../../../content/assettracker/accounts";
import { recurringFlows as definedRecurringFlows } from "../../../content/assettracker/recurringFlows";
import { snapshots as definedSnapshots } from "../../../content/assettracker/snapshots";
import { transfers as definedTransfers } from "../../../content/assettracker/transfers";
import {
  exchangeRateObservations as definedExchangeRateObservations,
  holdingObservations as definedHoldingObservations,
  instruments as definedInstruments,
  priceObservations as definedPriceObservations,
} from "../../../content/assettracker/valuations";
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
import type { IncomeRecord } from "./incomeRecord";
import type { PlannedExpenditure } from "./plannedExpenditure";
import type { RecurringFlow } from "./recurringFlow";
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
  transfers: Transfer[];
  recurringFlows: RecurringFlow[];
  plannedExpenditures: PlannedExpenditure[];
  instruments: Map<string, Instrument>;
  holdingObservations: HoldingObservation[];
  priceObservations: PriceObservation[];
  exchangeRateObservations: ExchangeRateObservation[];
  settings: AssetTrackerData["settings"];
}

/**
 * The bundled demo dataset. Serves as the pristine starting state for the
 * client-side store and the content rendered into the static build.
 */
export function getSeedData(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts: definedAccounts,
    snapshots: definedSnapshots,
    transfers: definedTransfers,
    recurringFlows: definedRecurringFlows,
    instruments: definedInstruments,
    holdingObservations: definedHoldingObservations,
    priceObservations: definedPriceObservations,
    exchangeRateObservations: definedExchangeRateObservations,
    settings: {
      expectedAnnualInflation: 0.025,
      targetNetWorth: { amount: 500_000, currency: "GBP" },
      targetNetWorthIsReal: true,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  });
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
  accounts: Map<AccountId, Account>,
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
    if (record.acceptedAt <= corrected.acceptedAt) {
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

function validateReferences(
  data: AssetTrackerData,
  accounts: Map<AccountId, Account>,
): void {
  validateCoreReferences(data, accounts);
  validatePlannedExpenditureReferences(data, accounts);
  validateValuationReferences(data, accounts);
}

export function buildRepository(
  data: AssetTrackerData,
): AssetTrackerRepository {
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
    transfers: data.transfers,
    recurringFlows: data.recurringFlows,
    plannedExpenditures: [...data.plannedExpenditures].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    instruments: new Map(
      (data.instruments ?? []).map((instrument) => [instrument.id, instrument]),
    ),
    holdingObservations: [...(data.holdingObservations ?? [])],
    priceObservations: [...(data.priceObservations ?? [])],
    exchangeRateObservations: [...(data.exchangeRateObservations ?? [])],
    settings: data.settings,
  };
}

let cachedRepository: AssetTrackerRepository | null = null;

export function loadAssetTrackerRepository(): AssetTrackerRepository {
  if (cachedRepository) return cachedRepository;
  cachedRepository = buildRepository(getSeedData());
  return cachedRepository;
}

export function resetRepositoryCache(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetRepositoryCache is only available in test env");
  }

  cachedRepository = null;
}
