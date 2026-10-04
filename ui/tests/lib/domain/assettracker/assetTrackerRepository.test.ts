import { describe, expect, it } from "vitest";
import type { AssetTrackerData } from "@/lib/domain/assettracker/assetTrackerData";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import { defaultHouseholdFields } from "@/lib/domain/assettracker/household";

function repositoryData(): AssetTrackerData {
  return {
    ...defaultHouseholdFields(),
    accounts: [
      {
        id: "isa-1",
        name: "Stocks ISA",
        provider: "Vanguard",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.07,
        createdAt: "2023-01-15",
      },
      {
        id: "savings-1",
        name: "Easy Access Savings",
        provider: "Marcus",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0.04,
        createdAt: "2022-06-01",
      },
    ],
    snapshots: [
      { accountId: "isa-1", date: "2024-06-01", balance: 12_000 },
      { accountId: "isa-1", date: "2024-01-01", balance: 10_000 },
      { accountId: "savings-1", date: "2024-03-15", balance: 5_100 },
    ],
    capitalFlows: [],
    incomeHistory: [],
    salaryHistory: [],
    transfers: [],
    recurringFlows: [],
    plannedExpenditures: [],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

describe("buildRepository", () => {
  it("indexes accounts and sorts snapshots by date", () => {
    const repository = buildRepository(repositoryData());

    expect(repository.accounts.size).toBe(2);
    expect(repository.accounts.has("isa-1")).toBe(true);
    expect(repository.snapshots.map((snapshot) => snapshot.date)).toEqual([
      "2024-01-01",
      "2024-03-15",
      "2024-06-01",
    ]);
  });

  it("throws on duplicate account IDs", () => {
    const data = repositoryData();
    data.accounts.push({ ...data.accounts[0]!, name: "Duplicate" });

    expect(() => buildRepository(data)).toThrow(/Duplicate account ID "isa-1"/);
  });

  it("throws when a snapshot references an unknown account", () => {
    const data = repositoryData();
    data.snapshots.push({
      accountId: "ghost-account",
      date: "2024-07-01",
      balance: 1_000,
    });

    expect(() => buildRepository(data)).toThrow(/ghost-account/);
  });
});
