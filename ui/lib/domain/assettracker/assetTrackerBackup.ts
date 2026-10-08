import { z } from "zod";
import {
  type AssetTrackerData,
  AssetTrackerDataError,
  AssetTrackerDataSchema,
} from "./assetTrackerData";
import { buildRepository } from "./assetTrackerRepository";
import { CurrencySchema } from "./currency";

export const ASSET_TRACKER_BACKUP_FORMAT =
  "assettracker-household-backup" as const;
export const ASSET_TRACKER_BACKUP_VERSION = 1 as const;

const AssetTrackerBackupBalanceSchema = z.object({
  currency: CurrencySchema,
  amount: z.number(),
});

export const AssetTrackerBackupSummarySchema = z.object({
  householdMembers: z.number().int().nonnegative(),
  accounts: z.number().int().nonnegative(),
  balanceObservations: z.number().int().nonnegative(),
  storedRecords: z.number().int().nonnegative(),
  latestAccountBalances: z.array(AssetTrackerBackupBalanceSchema),
});
export type AssetTrackerBackupSummary = z.infer<
  typeof AssetTrackerBackupSummarySchema
>;

export const AssetTrackerBackupSchema = z.object({
  format: z.literal(ASSET_TRACKER_BACKUP_FORMAT),
  schemaVersion: z.literal(ASSET_TRACKER_BACKUP_VERSION),
  createdAt: z.string().datetime({ offset: true }),
  summary: AssetTrackerBackupSummarySchema,
  data: z.unknown(),
});

export interface AssetTrackerBackup {
  format: typeof ASSET_TRACKER_BACKUP_FORMAT;
  schemaVersion: typeof ASSET_TRACKER_BACKUP_VERSION;
  createdAt: string;
  summary: AssetTrackerBackupSummary;
  data: AssetTrackerData;
}

export interface AssetTrackerBackupPreview {
  backup: AssetTrackerBackup;
  sourceVersion: number;
  migrated: boolean;
  current: AssetTrackerBackupSummary;
  replacement: AssetTrackerBackupSummary;
}

const LegacyBackupSchema = z.object({
  format: z.literal(ASSET_TRACKER_BACKUP_FORMAT),
  schemaVersion: z.literal(0),
  createdAt: z.string().datetime({ offset: true }).optional(),
  data: z.unknown(),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataCollections(data: AssetTrackerData): readonly unknown[][] {
  return [
    data.accounts,
    data.snapshots,
    data.capitalFlows,
    data.incomeHistory,
    data.salaryHistory,
    data.jobMoveScenarios ?? [],
    data.transfers,
    data.recurringFlows,
    data.plannedExpenditures,
    data.planningCases,
    data.futureCashFlows,
    data.forecastAssumptionSets,
    data.emergencyFundPlans ?? [],
    data.mortgageScenarios ?? [],
    data.decisionRecords ?? [],
    data.instruments ?? [],
    data.holdingObservations ?? [],
    data.priceObservations ?? [],
    data.exchangeRateObservations ?? [],
    data.propertyIndexHistories ?? [],
    data.propertyComparableSearches ?? [],
  ];
}

function latestAccountBalances(
  data: AssetTrackerData,
): AssetTrackerBackupSummary["latestAccountBalances"] {
  const latestByAccount = new Map<
    string,
    AssetTrackerData["snapshots"][number]
  >();
  for (const snapshot of data.snapshots) {
    const latest = latestByAccount.get(snapshot.accountId);
    if (latest == null || snapshot.date > latest.date) {
      latestByAccount.set(snapshot.accountId, snapshot);
    }
  }

  const totals = new Map<string, number>();
  for (const account of data.accounts) {
    const balance = latestByAccount.get(account.id)?.balance;
    if (balance == null) continue;
    totals.set(account.currency, (totals.get(account.currency) ?? 0) + balance);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({
      currency: CurrencySchema.parse(currency),
      amount,
    }));
}

export function summarizeAssetTrackerData(
  data: AssetTrackerData,
): AssetTrackerBackupSummary {
  return {
    householdMembers: data.household.members.length,
    accounts: data.accounts.length,
    balanceObservations: data.snapshots.length,
    storedRecords: dataCollections(data).reduce(
      (total, collection) => total + collection.length,
      0,
    ),
    latestAccountBalances: latestAccountBalances(data),
  };
}

function parseBackupData(raw: unknown): AssetTrackerData {
  const parsed = AssetTrackerDataSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AssetTrackerDataError(
      "Backup data is incomplete or contains invalid values",
    );
  }
  buildRepository(parsed.data);
  return parsed.data;
}

export function createAssetTrackerBackup(
  data: AssetTrackerData,
  createdAt = new Date().toISOString(),
): AssetTrackerBackup {
  const parsed = parseBackupData(data);
  return {
    format: ASSET_TRACKER_BACKUP_FORMAT,
    schemaVersion: ASSET_TRACKER_BACKUP_VERSION,
    createdAt,
    summary: summarizeAssetTrackerData(parsed),
    data: parsed,
  };
}

function summariesMatch(
  left: AssetTrackerBackupSummary,
  right: AssetTrackerBackupSummary,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readBackup(raw: unknown): {
  backup: AssetTrackerBackup;
  sourceVersion: number;
} {
  if (
    isObject(raw) &&
    raw.format === ASSET_TRACKER_BACKUP_FORMAT &&
    typeof raw.schemaVersion === "number" &&
    raw.schemaVersion > ASSET_TRACKER_BACKUP_VERSION
  ) {
    throw new AssetTrackerDataError(
      `This backup uses version ${raw.schemaVersion}. Update Asset Tracker before restoring it`,
    );
  }

  const current = AssetTrackerBackupSchema.safeParse(raw);
  if (current.success) {
    const data = parseBackupData(current.data.data);
    const expectedSummary = summarizeAssetTrackerData(data);
    if (!summariesMatch(current.data.summary, expectedSummary)) {
      throw new AssetTrackerDataError(
        "The backup summary does not match its household data. The file may be damaged",
      );
    }
    return {
      sourceVersion: current.data.schemaVersion,
      backup: { ...current.data, data },
    };
  }

  const legacyEnvelope = LegacyBackupSchema.safeParse(raw);
  if (legacyEnvelope.success) {
    return {
      sourceVersion: 0,
      backup: createAssetTrackerBackup(
        parseBackupData(legacyEnvelope.data.data),
        legacyEnvelope.data.createdAt ?? new Date(0).toISOString(),
      ),
    };
  }

  if (isObject(raw) && "accounts" in raw && "snapshots" in raw) {
    return {
      sourceVersion: 0,
      backup: createAssetTrackerBackup(
        parseBackupData(raw),
        new Date(0).toISOString(),
      ),
    };
  }

  throw new AssetTrackerDataError(
    "File is not a supported Asset Tracker backup",
  );
}

export function parseAssetTrackerBackup(raw: unknown): AssetTrackerBackup {
  return readBackup(raw).backup;
}

export function previewAssetTrackerBackup(
  currentData: AssetTrackerData,
  raw: unknown,
): AssetTrackerBackupPreview {
  const { backup, sourceVersion } = readBackup(raw);
  return {
    backup,
    sourceVersion,
    migrated: sourceVersion < ASSET_TRACKER_BACKUP_VERSION,
    current: summarizeAssetTrackerData(currentData),
    replacement: backup.summary,
  };
}
