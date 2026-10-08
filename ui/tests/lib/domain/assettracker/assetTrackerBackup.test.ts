import { describe, expect, it } from "vitest";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import {
  ASSET_TRACKER_BACKUP_FORMAT,
  ASSET_TRACKER_BACKUP_VERSION,
  AssetTrackerDataSchema,
  createAssetTrackerBackup,
  parseAssetTrackerBackup,
  previewAssetTrackerBackup,
} from "@/lib/domain/assettracker";

describe("Asset Tracker household backups", () => {
  const createdAt = "2026-10-08T16:00:00.000Z";

  it("round-trips the complete two-member demo household", () => {
    const data = getDemoAssetTrackerData();
    const backup = createAssetTrackerBackup(data, createdAt);
    const restored = parseAssetTrackerBackup(
      JSON.parse(JSON.stringify(backup)),
    );

    expect(restored).toEqual(backup);
    expect(restored.format).toBe(ASSET_TRACKER_BACKUP_FORMAT);
    expect(restored.schemaVersion).toBe(ASSET_TRACKER_BACKUP_VERSION);
    expect(restored.data.household).toEqual(data.household);
    expect(restored.data.ownership).toEqual(data.ownership);
    expect(restored.data.jobMoveScenarios).toEqual(data.jobMoveScenarios);
    expect(restored.data.planningCases).toEqual(data.planningCases);
    expect(restored.data.forecastAssumptionSets).toEqual(
      data.forecastAssumptionSets,
    );
    expect(restored.data.emergencyFundPlans).toEqual(data.emergencyFundPlans);
    expect(restored.summary.householdMembers).toBe(2);
    expect(restored.summary.accounts).toBe(data.accounts.length);
    expect(restored.summary.storedRecords).toBeGreaterThan(
      data.accounts.length + data.snapshots.length,
    );
  });

  it("previews current and replacement totals without changing either dataset", () => {
    const current = getDemoAssetTrackerData();
    const replacement = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "cash",
          name: "Cash",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2026-01-01",
        },
      ],
      snapshots: [{ accountId: "cash", date: "2026-01-01", balance: 1_000 }],
    });
    const backup = createAssetTrackerBackup(replacement, createdAt);

    const preview = previewAssetTrackerBackup(current, backup);

    expect(preview.current.accounts).toBe(current.accounts.length);
    expect(preview.replacement.accounts).toBe(1);
    expect(preview.backup.data.accounts).toEqual(replacement.accounts);
    expect(current.accounts).toHaveLength(
      getDemoAssetTrackerData().accounts.length,
    );
  });

  it("rejects a newer backup version with a useful message", () => {
    const backup = createAssetTrackerBackup(
      getDemoAssetTrackerData(),
      createdAt,
    );

    expect(() =>
      parseAssetTrackerBackup({ ...backup, schemaVersion: 2 }),
    ).toThrow(/version 2.*Update Asset Tracker/);
  });

  it("rejects a damaged summary before restore", () => {
    const backup = createAssetTrackerBackup(
      getDemoAssetTrackerData(),
      createdAt,
    );

    expect(() =>
      parseAssetTrackerBackup({
        ...backup,
        summary: { ...backup.summary, accounts: backup.summary.accounts + 1 },
      }),
    ).toThrow(/summary does not match/);
  });

  it("migrates version zero envelopes and legacy raw exports", () => {
    const data = getDemoAssetTrackerData();
    const versionZero = previewAssetTrackerBackup(data, {
      format: ASSET_TRACKER_BACKUP_FORMAT,
      schemaVersion: 0,
      createdAt,
      data,
    });
    const rawExport = previewAssetTrackerBackup(data, data);

    expect(versionZero.migrated).toBe(true);
    expect(versionZero.sourceVersion).toBe(0);
    expect(versionZero.backup.createdAt).toBe(createdAt);
    expect(rawExport.migrated).toBe(true);
    expect(rawExport.backup.data).toEqual(data);
  });

  it("rejects malformed files and orphaned references", () => {
    expect(() => parseAssetTrackerBackup({ hello: "world" })).toThrow(
      /not a supported Asset Tracker backup/,
    );
    expect(() =>
      parseAssetTrackerBackup({
        accounts: [],
        snapshots: [{ accountId: "missing", date: "2026-01-01", balance: 100 }],
      }),
    ).toThrow(/unknown account/);
  });
});
