import { describe, expect, it } from "vitest";
import { toBalancesCsv } from "@/lib/domain/assettracker/assetTrackerCsv";
import type { AssetTrackerData } from "@/lib/domain/assettracker/assetTrackerData";

function csvData(): AssetTrackerData {
  return {
    accounts: [
      {
        id: "isa",
        name: 'My "Big" ISA, really',
        provider: "Vanguard",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.07,
        createdAt: "2023-01-01",
      },
    ],
    snapshots: [
      { accountId: "isa", date: "2024-06-01", balance: 12000 },
      { accountId: "isa", date: "2024-01-01", balance: 10000 },
    ],
    capitalFlows: [],
    incomeHistory: [],
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

describe("toBalancesCsv", () => {
  it("emits one date-sorted row per balance with account metadata", () => {
    const lines = toBalancesCsv(csvData()).split("\n");

    expect(lines[0]).toBe("date,account,provider,type,currency,balance");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("2024-01-01");
    expect(lines[1]).toContain("10000");
    expect(lines[2]).toContain("2024-06-01");
  });

  it("quotes and escapes fields containing commas and quotes", () => {
    const csv = toBalancesCsv(csvData());

    expect(csv).toContain('"My ""Big"" ISA, really"');
  });
});
