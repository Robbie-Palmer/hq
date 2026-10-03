import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  applyImportAccountHistory,
  applyImportIncomeHistory,
  applySetAccountOwnership,
  buildRepository,
  equalSharedOwnership,
  getNetWorthTimeSeries,
  personalOwnership,
  scopeAssetTrackerData,
  snapshotOwnershipKey,
} from "@/lib/domain/assettracker";

function oldSinglePersonData() {
  return {
    accounts: [
      {
        id: "cash",
        name: "Cash",
        provider: "Bank",
        currency: "GBP" as const,
        assetType: "cash" as const,
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [{ accountId: "cash", date: "2025-01-31", balance: 1_000 }],
    capitalFlows: [{ accountId: "cash", date: "2025-01-15", amount: 200 }],
    incomeHistory: [
      { date: "2025-01-31", amount: 3_000, currency: "GBP" as const },
    ],
    transfers: [],
    recurringFlows: [],
    plannedExpenditures: [],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP" as const,
      valuationMaxAgeDays: 7,
    },
  };
}

describe("browser household ownership", () => {
  it("migrates old single-person data without changing financial records", () => {
    const data = AssetTrackerDataSchema.parse(oldSinglePersonData());

    expect(data.household.members).toEqual([
      { id: "primary", displayName: "Me" },
    ]);
    expect(data.accounts).toEqual(oldSinglePersonData().accounts);
    expect(data.snapshots).toEqual(oldSinglePersonData().snapshots);
    expect(data.ownership.accounts.cash).toEqual(personalOwnership("primary"));
    expect(
      data.ownership.snapshots[snapshotOwnershipKey("cash", "2025-01-31")],
    ).toEqual(personalOwnership("primary"));
  });

  it("filters personal records and allocates shared values by recorded shares", () => {
    const migrated = AssetTrackerDataSchema.parse(oldSinglePersonData());
    const withMembers = AssetTrackerDataSchema.parse({
      ...migrated,
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      ownership: {
        ...migrated.ownership,
        accounts: { cash: personalOwnership("primary") },
        snapshots: {
          [snapshotOwnershipKey("cash", "2025-01-31")]:
            personalOwnership("primary"),
        },
        capitalFlows: {
          "cash\u00002025-01-15\u0000personalSaving":
            personalOwnership("primary"),
        },
        incomeHistory: {
          "2025-01-31": {
            kind: "shared",
            shares: [
              { memberId: "primary", share: 0.75 },
              { memberId: "sam", share: 0.25 },
            ],
          },
        },
      },
    });

    const alex = scopeAssetTrackerData({
      ...withMembers,
      household: {
        ...withMembers.household,
        activeScope: { kind: "member", memberId: "primary" },
      },
    });
    const sam = scopeAssetTrackerData({
      ...withMembers,
      household: {
        ...withMembers.household,
        activeScope: { kind: "member", memberId: "sam" },
      },
    });

    expect(alex.snapshots[0]?.balance).toBe(1_000);
    expect(alex.incomeHistory[0]?.amount).toBe(2_250);
    expect(sam.accounts).toEqual([]);
    expect(sam.incomeHistory[0]?.amount).toBe(750);
    expect(withMembers.incomeHistory[0]?.amount).toBe(3_000);
  });

  it("updates existing account records when ownership becomes shared", () => {
    const migrated = AssetTrackerDataSchema.parse(oldSinglePersonData());
    const data = AssetTrackerDataSchema.parse({
      ...migrated,
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      ownership: {
        ...migrated.ownership,
        accounts: { cash: personalOwnership("primary") },
        snapshots: {
          [snapshotOwnershipKey("cash", "2025-01-31")]:
            personalOwnership("primary"),
        },
      },
    });
    const shared = equalSharedOwnership(data.household.members);
    const updated = applySetAccountOwnership(data, {
      accountId: "cash",
      ownership: shared,
    });
    const samData = scopeAssetTrackerData({
      ...updated,
      household: {
        ...updated.household,
        activeScope: { kind: "member", memberId: "sam" },
      },
    });

    expect(samData.snapshots[0]?.balance).toBe(500);
    expect(getNetWorthTimeSeries(buildRepository(samData)).at(-1)?.total).toBe(
      500,
    );
    expect(getNetWorthTimeSeries(buildRepository(updated)).at(-1)?.total).toBe(
      1_000,
    );
  });

  it("applies reviewed import ownership to every committed row", () => {
    const migrated = AssetTrackerDataSchema.parse(oldSinglePersonData());
    const householdData = AssetTrackerDataSchema.parse({
      ...migrated,
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      ownership: {
        ...migrated.ownership,
        accounts: { cash: personalOwnership("primary") },
        snapshots: {
          [snapshotOwnershipKey("cash", "2025-01-31")]:
            personalOwnership("primary"),
        },
      },
    });
    const sam = personalOwnership("sam");
    const withBalances = applyImportAccountHistory(householdData, {
      accountId: "cash",
      balances: [{ date: "2025-02-28", value: 1_400 }],
      capitalFlows: [{ date: "2025-02-15", value: 300 }],
      ownership: sam,
    });
    const withIncome = applyImportIncomeHistory(withBalances, {
      income: [
        { date: "2025-01-31", amount: 4_000 },
        { date: "2025-02-28", amount: 4_100 },
      ],
      ownership: sam,
    });

    expect(withIncome.ownership.accounts.cash).toEqual(sam);
    expect(
      withIncome.ownership.snapshots[
        snapshotOwnershipKey("cash", "2025-02-28")
      ],
    ).toEqual(sam);
    expect(
      withIncome.ownership.capitalFlows[
        "cash\u00002025-02-15\u0000personalSaving"
      ],
    ).toEqual(sam);
    expect(withIncome.ownership.incomeHistory).toMatchObject({
      "2025-01-31": sam,
      "2025-02-28": sam,
    });
  });
});
