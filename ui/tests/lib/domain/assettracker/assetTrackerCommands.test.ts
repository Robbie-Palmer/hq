import { describe, expect, it } from "vitest";
import {
  AssetTrackerCommandError,
  applyAddPlannedExpenditure,
  applyAddRecurringFlow,
  applyClearAccountHistory,
  applyClearIncomeHistory,
  applyCloseAccount,
  applyCreateAccount,
  applyDeleteCapitalFlow,
  applyDeletePlannedExpenditure,
  applyDeleteRecurringFlow,
  applyDeleteSnapshot,
  applyImportAccountHistory,
  applyImportIncomeHistory,
  applyMaterializeFlow,
  applyRecordBalance,
  applyRecordTransfer,
  applySetAccountLiquidity,
  applySetExpectedReturn,
  applySetNetWorthTarget,
  applySetWithdrawalRate,
  formatAssetTrackerError,
} from "@/lib/domain/assettracker/assetTrackerCommands";
import {
  type AssetTrackerData,
  AssetTrackerDataError,
} from "@/lib/domain/assettracker/assetTrackerData";
import { flowOccurrenceDates } from "@/lib/domain/assettracker/recurringFlow";

function baseData(): AssetTrackerData {
  return {
    accounts: [
      {
        id: "stocks-isa",
        name: "Stocks ISA",
        provider: "Vanguard",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.07,
        createdAt: "2023-01-15",
      },
      {
        id: "savings",
        name: "Savings",
        provider: "Marcus",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0.04,
        createdAt: "2022-01-01",
      },
      {
        id: "credit-card",
        name: "Credit Card",
        provider: "Amex",
        currency: "GBP",
        assetType: "debt",
        expectedAnnualReturn: 0.249,
        createdAt: "2022-01-01",
      },
      {
        id: "old-pension",
        name: "Old Pension",
        provider: "Aviva",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.06,
        createdAt: "2018-01-01",
        closedAt: "2023-06-30",
      },
    ],
    snapshots: [
      { accountId: "stocks-isa", date: "2024-01-01", balance: 10000 },
      { accountId: "stocks-isa", date: "2024-06-01", balance: 12000 },
      { accountId: "savings", date: "2024-06-01", balance: 5000 },
      { accountId: "credit-card", date: "2024-06-01", balance: -800 },
      { accountId: "old-pension", date: "2023-06-30", balance: 0 },
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

describe("applyCreateAccount", () => {
  it("creates an account with a slugified ID", () => {
    const { data, account } = applyCreateAccount(baseData(), {
      name: "Marcus Savings",
      provider: "Goldman Sachs",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0.045,
      openingDate: "2024-01-01",
    });

    expect(account.id).toBe("marcus-savings");
    expect(account.createdAt).toBe("2024-01-01");
    expect(data.accounts).toHaveLength(5);
    expect(data.snapshots).toHaveLength(5);
  });

  it("suffixes the ID when the slug is already taken", () => {
    const { account } = applyCreateAccount(baseData(), {
      name: "Stocks ISA",
      provider: "Trading 212",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0.07,
    });

    expect(account.id).toBe("stocks-isa-2");
  });

  it("records the opening balance as a snapshot", () => {
    const { data, account } = applyCreateAccount(baseData(), {
      name: "Premium Bonds",
      provider: "NS&I",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0.04,
      openingBalance: 5000,
      openingDate: "2024-03-01",
    });

    expect(data.snapshots).toContainEqual({
      accountId: account.id,
      date: "2024-03-01",
      balance: 5000,
    });
  });

  it("links a mortgage to an existing account", () => {
    const { account } = applyCreateAccount(baseData(), {
      name: "Home Mortgage",
      provider: "Nationwide",
      currency: "GBP",
      assetType: "mortgage",
      expectedAnnualReturn: 0.045,
      linkedAccountId: "savings",
    });

    expect(account.linkedAccountId).toBe("savings");
  });

  it("rejects linking to an unknown account", () => {
    expect(() =>
      applyCreateAccount(baseData(), {
        name: "Home Mortgage",
        provider: "Nationwide",
        currency: "GBP",
        assetType: "mortgage",
        expectedAnnualReturn: 0.045,
        linkedAccountId: "ghost",
      }),
    ).toThrow(/Account not found/);
  });

  it("rejects an empty name", () => {
    expect(() =>
      applyCreateAccount(baseData(), {
        name: "  ",
        provider: "Anywhere",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0.01,
      }),
    ).toThrow();
  });

  it("rejects a name that produces no slug", () => {
    expect(() =>
      applyCreateAccount(baseData(), {
        name: "!!!",
        provider: "Anywhere",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0.01,
      }),
    ).toThrow(AssetTrackerCommandError);
  });

  it("does not mutate the input data", () => {
    const data = baseData();
    applyCreateAccount(data, {
      name: "New Account",
      provider: "Provider",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0.02,
      openingBalance: 100,
    });

    expect(data).toEqual(baseData());
  });
});

describe("applyRecordBalance", () => {
  it("appends a new snapshot", () => {
    const next = applyRecordBalance(baseData(), {
      accountId: "stocks-isa",
      date: "2024-12-01",
      balance: 13500,
    });

    expect(next.snapshots).toHaveLength(6);
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2024-12-01",
      balance: 13500,
    });
  });

  it("replaces an existing snapshot for the same account and date", () => {
    const next = applyRecordBalance(baseData(), {
      accountId: "stocks-isa",
      date: "2024-06-01",
      balance: 12345,
    });

    expect(next.snapshots).toHaveLength(5);
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2024-06-01",
      balance: 12345,
    });
  });

  it("rejects an unknown account", () => {
    expect(() =>
      applyRecordBalance(baseData(), {
        accountId: "ghost",
        date: "2024-01-01",
        balance: 100,
      }),
    ).toThrow(/Account not found/);
  });

  it("rejects a balance after the account closed", () => {
    expect(() =>
      applyRecordBalance(baseData(), {
        accountId: "old-pension",
        date: "2024-01-01",
        balance: 100,
      }),
    ).toThrow(/closed on 2023-06-30/);
  });

  it("allows backfilling history before the closure date", () => {
    const next = applyRecordBalance(baseData(), {
      accountId: "old-pension",
      date: "2022-01-01",
      balance: 15000,
    });

    expect(next.snapshots).toContainEqual({
      accountId: "old-pension",
      date: "2022-01-01",
      balance: 15000,
    });
  });

  it("allows negative balances for liabilities", () => {
    const next = applyRecordBalance(baseData(), {
      accountId: "credit-card",
      date: "2024-12-01",
      balance: -1500,
    });

    expect(next.snapshots).toContainEqual({
      accountId: "credit-card",
      date: "2024-12-01",
      balance: -1500,
    });
  });
});

describe("applyImportAccountHistory", () => {
  it("atomically upserts balances and signed deposits or withdrawals", () => {
    const next = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [
        { date: "2024-06-01", value: 12500 },
        { date: "2024-12-01", value: 14000 },
      ],
      capitalFlows: [
        { date: "2024-06-01", value: 2500 },
        { date: "2024-12-01", value: -500 },
      ],
    });

    expect(next.snapshots.filter((s) => s.accountId === "stocks-isa")).toEqual(
      expect.arrayContaining([
        { accountId: "stocks-isa", date: "2024-06-01", balance: 12500 },
        { accountId: "stocks-isa", date: "2024-12-01", balance: 14000 },
      ]),
    );
    expect(next.capitalFlows).toEqual([
      { accountId: "stocks-isa", date: "2024-06-01", amount: 2500 },
      { accountId: "stocks-isa", date: "2024-12-01", amount: -500 },
    ]);
  });

  it("rejects the whole import when one row is after account closure", () => {
    const data = baseData();

    expect(() =>
      applyImportAccountHistory(data, {
        accountId: "old-pension",
        balances: [
          { date: "2022-01-01", value: 10000 },
          { date: "2024-01-01", value: 12000 },
        ],
        capitalFlows: [],
      }),
    ).toThrow(/closed/);
    expect(data).toEqual(baseData());
  });

  it("preserves last-row-wins upsert semantics within one bulk import", () => {
    const next = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [
        { date: "2024-06-01", value: 12500 },
        { date: "2024-06-01", value: 13000 },
      ],
      capitalFlows: [
        { date: "2024-06-01", value: 1000 },
        { date: "2024-06-01", value: 1500 },
      ],
    });

    expect(
      next.snapshots.filter(
        (snapshot) =>
          snapshot.accountId === "stocks-isa" && snapshot.date === "2024-06-01",
      ),
    ).toEqual([
      { accountId: "stocks-isa", date: "2024-06-01", balance: 13000 },
    ]);
    expect(next.capitalFlows).toEqual([
      { accountId: "stocks-isa", date: "2024-06-01", amount: 1500 },
    ]);
  });

  it("can replace one account's complete capital-flow series", () => {
    const imported = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-01-01", value: 100 }],
    });
    const withOtherAccount = applyImportAccountHistory(imported, {
      accountId: "savings",
      balances: [],
      capitalFlows: [{ date: "2024-01-01", value: 50 }],
    });

    const next = applyImportAccountHistory(withOtherAccount, {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 250 }],
      replaceCapitalFlows: true,
    });

    expect(next.capitalFlows).toEqual([
      { accountId: "savings", date: "2024-01-01", amount: 50 },
      { accountId: "stocks-isa", date: "2024-06-01", amount: 250 },
    ]);
  });

  it("preserves capital flows during a balance-only replacement import", () => {
    const imported = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-01-01", value: 100 }],
      capitalFlowKind: "personalSaving",
    });

    const next = applyImportAccountHistory(imported, {
      accountId: "stocks-isa",
      balances: [{ date: "2024-06-01", value: 13_000 }],
      capitalFlows: [],
      capitalFlowKind: "personalSaving",
      replaceCapitalFlows: true,
    });

    expect(next.capitalFlows).toEqual(imported.capitalFlows);
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2024-06-01",
      balance: 13_000,
    });
  });

  it("keeps independently classified capital histories on the same date", () => {
    const personal = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 400 }],
      capitalFlowKind: "personalSaving",
      replaceCapitalFlows: true,
    });
    const combined = applyImportAccountHistory(personal, {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 200 }],
      capitalFlowKind: "external",
      replaceCapitalFlows: true,
    });

    expect(combined.capitalFlows).toEqual([
      {
        accountId: "stocks-isa",
        date: "2024-06-01",
        amount: 400,
        kind: "personalSaving",
      },
      {
        accountId: "stocks-isa",
        date: "2024-06-01",
        amount: 200,
        kind: "external",
      },
    ]);

    expect(
      applyDeleteCapitalFlow(combined, {
        accountId: "stocks-isa",
        date: "2024-06-01",
        kind: "external",
      }).capitalFlows,
    ).toEqual([
      {
        accountId: "stocks-isa",
        date: "2024-06-01",
        amount: 400,
        kind: "personalSaving",
      },
    ]);
  });

  it("deletes a capital-flow observation", () => {
    const imported = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 500 }],
    });

    const next = applyDeleteCapitalFlow(imported, {
      accountId: "stocks-isa",
      date: "2024-06-01",
    });
    expect(next.capitalFlows).toEqual([]);
    expect(() =>
      applyDeleteCapitalFlow(next, {
        accountId: "stocks-isa",
        date: "2024-06-01",
      }),
    ).toThrow(/No deposit or withdrawal/);
    expect(() =>
      applyDeleteCapitalFlow(imported, {
        accountId: "stocks-isa",
        date: "2024-06-01",
        kind: "external",
      }),
    ).toThrow(/kind "external"/);
  });
});

describe("portfolio income settings", () => {
  it("replaces and sorts the complete income history", () => {
    const imported = applyImportIncomeHistory(baseData(), {
      income: [
        { date: "2025-02-28", amount: 4_200 },
        { date: "2025-01-31", amount: 4_100 },
      ],
    });

    expect(imported.incomeHistory).toEqual([
      { date: "2025-01-31", amount: 4_100, currency: "GBP" },
      { date: "2025-02-28", amount: 4_200, currency: "GBP" },
    ]);
    expect(applyClearIncomeHistory(imported).incomeHistory).toEqual([]);
  });

  it("rejects duplicate income dates and invalid withdrawal rates", () => {
    let duplicateError: unknown;
    try {
      applyImportIncomeHistory(baseData(), {
        income: [
          { date: "2025-01-31", amount: 4_100 },
          { date: "2025-01-31", amount: 4_200 },
        ],
      });
    } catch (error) {
      duplicateError = error;
    }
    expect(formatAssetTrackerError(duplicateError)).toBe(
      "Duplicate income record on 2025-01-31",
    );
    expect(() => applySetWithdrawalRate(baseData(), { rate: 0 })).toThrow(
      "Withdrawal rate must be positive",
    );
  });

  it("stores an editable withdrawal rate", () => {
    expect(
      applySetWithdrawalRate(baseData(), { rate: 0.035 }).settings
        .withdrawalRate,
    ).toBe(0.035);
  });
});

describe("formatAssetTrackerError", () => {
  it("surfaces safe imported-data validation messages", () => {
    expect(
      formatAssetTrackerError(
        new AssetTrackerDataError("Imported account reference is invalid"),
      ),
    ).toBe("Imported account reference is invalid");
  });

  it("does not expose unexpected internal error messages", () => {
    expect(formatAssetTrackerError(new Error("internal storage detail"))).toBe(
      "Something went wrong",
    );
  });
});

describe("applyRecordTransfer", () => {
  it("decreases the source and increases the destination", () => {
    const next = applyRecordTransfer(baseData(), {
      date: "2024-07-01",
      fromAccountId: "savings",
      toAccountId: "stocks-isa",
      amount: 1000,
    });

    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-07-01",
      balance: 4000,
    });
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2024-07-01",
      balance: 13000,
    });
    expect(next.transfers).toHaveLength(1);
    expect(next.transfers[0]).toMatchObject({
      fromAccountId: "savings",
      toAccountId: "stocks-isa",
      amount: 1000,
    });
  });

  it("supports external income with no source account", () => {
    const next = applyRecordTransfer(baseData(), {
      date: "2024-07-01",
      toAccountId: "savings",
      amount: 250,
    });

    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-07-01",
      balance: 5250,
    });
  });

  it("pays down a debt balance towards zero", () => {
    const next = applyRecordTransfer(baseData(), {
      date: "2024-07-01",
      fromAccountId: "savings",
      toAccountId: "credit-card",
      amount: 800,
    });

    expect(next.snapshots).toContainEqual({
      accountId: "credit-card",
      date: "2024-07-01",
      balance: 0,
    });
  });

  it("records both native amounts for a cross-currency transfer", () => {
    const data = baseData();
    data.accounts.push({
      id: "usd-cash",
      name: "USD cash",
      provider: "Bank",
      currency: "USD",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push({
      accountId: "usd-cash",
      date: "2024-06-01",
      balance: 0,
    });

    const next = applyRecordTransfer(data, {
      date: "2024-07-01",
      fromAccountId: "savings",
      toAccountId: "usd-cash",
      amount: 800,
      receivedAmount: 1_000,
      feeAmount: 10,
      conversionProvider: "Low-cost broker",
    });

    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-07-01",
      balance: 4_190,
    });
    expect(next.snapshots).toContainEqual({
      accountId: "usd-cash",
      date: "2024-07-01",
      balance: 1_000,
    });
    expect(next.transfers[0]).toMatchObject({
      amount: 800,
      fromAmount: 800,
      toAmount: 1_000,
      feeAmount: 10,
      conversionProvider: "Low-cost broker",
    });
  });

  it("requires the received amount when currencies differ", () => {
    const data = baseData();
    data.accounts.push({
      id: "usd-cash",
      name: "USD cash",
      provider: "Bank",
      currency: "USD",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });

    expect(() =>
      applyRecordTransfer(data, {
        date: "2024-07-01",
        fromAccountId: "savings",
        toAccountId: "usd-cash",
        amount: 800,
      }),
    ).toThrow(/amount received/);
  });

  it("rejects a transfer with neither side", () => {
    expect(() =>
      applyRecordTransfer(baseData(), { date: "2024-07-01", amount: 100 }),
    ).toThrow(/source or a destination/);
  });

  it("rejects a transfer into a closed account", () => {
    expect(() =>
      applyRecordTransfer(baseData(), {
        date: "2024-07-01",
        toAccountId: "old-pension",
        amount: 100,
      }),
    ).toThrow(/closed/);
  });
});

describe("flowOccurrenceDates", () => {
  const monthly = {
    id: "f",
    name: "Monthly",
    toAccountId: "savings",
    amount: 100,
    currency: "GBP" as const,
    frequency: "monthly" as const,
    startDate: "2024-01-15",
  };

  it("lists each due date through the cutoff", () => {
    expect(flowOccurrenceDates(monthly, "2024-04-01")).toEqual([
      "2024-01-15",
      "2024-02-15",
      "2024-03-15",
    ]);
  });

  it("honours an end date", () => {
    expect(
      flowOccurrenceDates({ ...monthly, endDate: "2024-02-20" }, "2024-06-01"),
    ).toEqual(["2024-01-15", "2024-02-15"]);
  });

  it("only returns occurrences after a given date", () => {
    expect(flowOccurrenceDates(monthly, "2024-05-01", "2024-02-15")).toEqual([
      "2024-03-15",
      "2024-04-15",
    ]);
  });

  it("steps weekly", () => {
    expect(
      flowOccurrenceDates(
        { ...monthly, frequency: "weekly", startDate: "2024-01-01" },
        "2024-01-22",
      ),
    ).toEqual(["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22"]);
  });
});

describe("applyMaterializeFlow", () => {
  function withSalaryFlow(): AssetTrackerData {
    return applyAddRecurringFlow(baseData(), {
      name: "Salary",
      toAccountId: "savings",
      amount: 1000,
      frequency: "monthly",
      startDate: "2024-06-01",
    });
  }

  it("turns a flow's due payments into real transfers and balances", () => {
    const next = applyMaterializeFlow(withSalaryFlow(), {
      flowId: "salary",
      throughDate: "2024-08-15",
    });

    const salaryTransfers = next.transfers.filter((t) => t.flowId === "salary");
    expect(salaryTransfers.map((t) => t.date)).toEqual([
      "2024-06-01",
      "2024-07-01",
      "2024-08-01",
    ]);
    // Savings started at 5,000 (2024-06-01); three £1,000 credits land
    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-08-01",
      balance: 8000,
    });
  });

  it("only tops up newly-due periods when re-run", () => {
    const once = applyMaterializeFlow(withSalaryFlow(), {
      flowId: "salary",
      throughDate: "2024-07-15",
    });
    const twice = applyMaterializeFlow(once, {
      flowId: "salary",
      throughDate: "2024-09-15",
    });

    const dates = twice.transfers
      .filter((t) => t.flowId === "salary")
      .map((t) => t.date);
    // No duplicates for June/July, and August/September added
    expect(dates).toEqual([
      "2024-06-01",
      "2024-07-01",
      "2024-08-01",
      "2024-09-01",
    ]);
  });

  it("pays a formula debt down and stops once it's cleared", () => {
    let data = applyAddRecurringFlow(baseData(), {
      name: "Card payment",
      fromAccountId: "savings",
      toAccountId: "credit-card",
      formula: { kind: "minimumPayment", percentOfBalance: 0.5, floor: 100 },
      frequency: "monthly",
      startDate: "2024-07-01",
    });
    // Card owes 800 at 2024-06-01
    data = applyMaterializeFlow(data, {
      flowId: "card-payment",
      throughDate: "2025-07-01",
    });

    const card = data.snapshots
      .filter((s) => s.accountId === "credit-card")
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    // Debt is fully cleared, never overpaid past zero
    expect(card?.balance).toBe(0);
  });

  it("rejects an unknown flow", () => {
    expect(() =>
      applyMaterializeFlow(baseData(), {
        flowId: "ghost",
        throughDate: "2024-12-01",
      }),
    ).toThrow(/No recurring flow/);
  });
});

describe("applyCloseAccount", () => {
  it("sets closedAt and records a final zero balance", () => {
    const next = applyCloseAccount(baseData(), {
      accountId: "stocks-isa",
      closedAt: "2025-01-01",
    });

    const account = next.accounts.find((a) => a.id === "stocks-isa");
    expect(account?.closedAt).toBe("2025-01-01");
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2025-01-01",
      balance: 0,
    });
  });

  it("rejects closing an already closed account", () => {
    expect(() =>
      applyCloseAccount(baseData(), {
        accountId: "old-pension",
        closedAt: "2025-01-01",
      }),
    ).toThrow(/already closed/);
  });

  it("transfers the remaining balance before closing", () => {
    const next = applyCloseAccount(baseData(), {
      accountId: "savings",
      closedAt: "2025-01-01",
      transferToAccountId: "stocks-isa",
    });

    const savings = next.accounts.find((a) => a.id === "savings");
    expect(savings?.closedAt).toBe("2025-01-01");
    // Savings ends at zero, ISA receives the £5,000
    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2025-01-01",
      balance: 0,
    });
    expect(next.snapshots).toContainEqual({
      accountId: "stocks-isa",
      date: "2025-01-01",
      balance: 17000,
    });
    expect(next.transfers).toHaveLength(1);
  });

  it("rejects transferring the balance to the account being closed", () => {
    expect(() =>
      applyCloseAccount(baseData(), {
        accountId: "savings",
        closedAt: "2025-01-01",
        transferToAccountId: "savings",
      }),
    ).toThrow();
  });

  it("rejects closing before a later recorded balance", () => {
    // savings has a snapshot on 2024-06-01; closing earlier would strand it
    expect(() =>
      applyCloseAccount(baseData(), {
        accountId: "savings",
        closedAt: "2024-01-01",
      }),
    ).toThrow(/recorded after/);
  });

  it("rejects closing an account that funds planned spending", () => {
    const data = applyAddPlannedExpenditure(baseData(), {
      name: "New car",
      amount: 20_000,
      date: "2099-06-01",
      fromAccountId: "savings",
    });

    expect(() =>
      applyCloseAccount(data, {
        accountId: "savings",
        closedAt: "2025-01-01",
      }),
    ).toThrow(/funds planned spending/);
  });

  it("does not overwrite a balance already recorded on the close date", () => {
    // User logs £5,000 on 2024-06-01, then closes that same day
    const next = applyCloseAccount(baseData(), {
      accountId: "savings",
      closedAt: "2024-06-01",
    });

    const account = next.accounts.find((a) => a.id === "savings");
    expect(account?.closedAt).toBe("2024-06-01");
    // The recorded £5,000 survives rather than being clobbered with £0
    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-06-01",
      balance: 5000,
    });
  });
});

describe("applyAddRecurringFlow / applyDeleteRecurringFlow", () => {
  it("rejects a whitespace-only flow name", () => {
    expect(() =>
      applyAddRecurringFlow(baseData(), {
        name: "   ",
        toAccountId: "savings",
        amount: 3_000,
        frequency: "monthly",
        startDate: "2024-07-01",
      }),
    ).toThrow(/Give the flow a name/);
  });

  it("adds a fixed flow with a slugified ID", () => {
    const next = applyAddRecurringFlow(baseData(), {
      name: "ISA contribution",
      fromAccountId: "savings",
      toAccountId: "stocks-isa",
      amount: 500,
      frequency: "monthly",
      startDate: "2024-07-01",
    });

    expect(next.recurringFlows).toHaveLength(1);
    expect(next.recurringFlows[0]).toMatchObject({
      id: "isa-contribution",
      amount: 500,
      frequency: "monthly",
    });
  });

  it("requires and materializes an explicit cross-currency conversion", () => {
    const data = baseData();
    data.accounts.push({
      id: "usd-cash",
      name: "USD cash",
      provider: "Bank",
      currency: "USD",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push({
      accountId: "usd-cash",
      date: "2024-06-01",
      balance: 0,
    });

    expect(() =>
      applyAddRecurringFlow(data, {
        name: "Fund USD account",
        fromAccountId: "savings",
        toAccountId: "usd-cash",
        amount: 800,
        frequency: "monthly",
        startDate: "2024-07-01",
      }),
    ).toThrow(/expected amount received/);

    const withFlow = applyAddRecurringFlow(data, {
      name: "Fund USD account",
      fromAccountId: "savings",
      toAccountId: "usd-cash",
      amount: 800,
      frequency: "monthly",
      startDate: "2024-07-01",
      conversion: {
        received: { amount: 1_000, currency: "USD" },
        fee: { amount: 10, currency: "GBP" },
        provider: "Low-cost broker",
      },
    });
    const next = applyMaterializeFlow(withFlow, {
      flowId: "fund-usd-account",
      throughDate: "2024-07-01",
    });

    expect(next.recurringFlows[0]).toMatchObject({
      currency: "GBP",
      conversion: {
        received: { amount: 1_000, currency: "USD" },
        fee: { amount: 10, currency: "GBP" },
        provider: "Low-cost broker",
      },
    });
    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-07-01",
      balance: 4_190,
    });
    expect(next.snapshots).toContainEqual({
      accountId: "usd-cash",
      date: "2024-07-01",
      balance: 1_000,
    });
    expect(next.transfers[0]).toMatchObject({
      fromAmount: 800,
      toAmount: 1_000,
      feeAmount: 10,
      conversionProvider: "Low-cost broker",
    });
  });

  it("preserves compensation classification on an external income flow", () => {
    const next = applyAddRecurringFlow(baseData(), {
      name: "Employer pension",
      toAccountId: "stocks-isa",
      amount: 375,
      compensationKind: "employerPension",
      frequency: "monthly",
      startDate: "2024-07-01",
    });

    expect(next.recurringFlows[0]?.compensationKind).toBe("employerPension");
  });

  it("preserves gross pay on a take-home income flow", () => {
    const next = applyAddRecurringFlow(baseData(), {
      name: "Take-home salary",
      toAccountId: "savings",
      amount: 3_000,
      grossAmount: 5_000,
      compensationKind: "takeHomeIncome",
      frequency: "monthly",
      startDate: "2024-07-01",
    });

    expect(next.recurringFlows[0]?.grossAmount).toBe(5_000);
  });

  it("rejects compensation classified as an internal transfer", () => {
    expect(() =>
      applyAddRecurringFlow(baseData(), {
        name: "Misclassified pension",
        fromAccountId: "savings",
        toAccountId: "stocks-isa",
        amount: 500,
        compensationKind: "employeePension",
        frequency: "monthly",
        startDate: "2024-07-01",
      }),
    ).toThrow(/entering an account from outside/);
  });

  it("adds a minimum payment formula flow", () => {
    const next = applyAddRecurringFlow(baseData(), {
      name: "Card minimum payment",
      fromAccountId: "savings",
      toAccountId: "credit-card",
      formula: { kind: "minimumPayment", percentOfBalance: 0.025, floor: 25 },
      frequency: "monthly",
      startDate: "2024-07-01",
    });

    expect(next.recurringFlows[0]?.formula).toEqual({
      kind: "minimumPayment",
      percentOfBalance: 0.025,
      floor: 25,
    });
  });

  it("rejects a flow with neither amount nor formula", () => {
    expect(() =>
      applyAddRecurringFlow(baseData(), {
        name: "Mystery flow",
        toAccountId: "savings",
        frequency: "monthly",
      }),
    ).toThrow(/amount or a formula/);
  });

  it("deletes a flow and rejects unknown IDs", () => {
    const withFlow = applyAddRecurringFlow(baseData(), {
      name: "Salary",
      toAccountId: "savings",
      amount: 3000,
      frequency: "monthly",
    });

    const next = applyDeleteRecurringFlow(withFlow, { id: "salary" });
    expect(next.recurringFlows).toHaveLength(0);
    expect(() => applyDeleteRecurringFlow(next, { id: "salary" })).toThrow(
      /No recurring flow/,
    );
  });
});

describe("planned expenditures", () => {
  it("adds and removes a dated expenditure", () => {
    const added = applyAddPlannedExpenditure(baseData(), {
      name: "Kitchen repair",
      amount: 4_500,
      date: "2099-06-01",
      fromAccountId: "savings",
    });

    expect(added.plannedExpenditures[0]).toMatchObject({
      id: "kitchen-repair",
      amount: 4_500,
      fromAccountId: "savings",
    });
    const removed = applyDeletePlannedExpenditure(added, {
      id: "kitchen-repair",
    });
    expect(removed.plannedExpenditures).toEqual([]);
  });

  it("rejects spending from an unknown account", () => {
    expect(() =>
      applyAddPlannedExpenditure(baseData(), {
        name: "Car",
        amount: 20_000,
        date: "2099-06-01",
        fromAccountId: "missing",
      }),
    ).toThrow(/Account not found/);
  });

  it("rejects spending directly from an illiquid account", () => {
    const data = baseData();
    const isa = data.accounts.find((account) => account.id === "stocks-isa");
    if (isa) isa.liquidity = "illiquid";
    try {
      applyAddPlannedExpenditure(data, {
        name: "Car",
        amount: 20_000,
        date: "2099-06-01",
        fromAccountId: "stocks-isa",
      });
      throw new Error("Expected planned expenditure validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetTrackerCommandError);
      expect(formatAssetTrackerError(error)).toBe(
        "Planned expenditure must come from cash or a liquid investment",
      );
    }
  });

  it("rejects spending from an account that is already closed", () => {
    expect(() =>
      applyAddPlannedExpenditure(baseData(), {
        name: "Car",
        amount: 20_000,
        date: "2023-01-01",
        fromAccountId: "old-pension",
      }),
    ).toThrow("Planned expenditure must come from an open account");
  });

  it("rejects expenditure dates that have already passed", () => {
    try {
      applyAddPlannedExpenditure(baseData(), {
        name: "Old plan",
        amount: 100,
        date: "2000-01-01",
        fromAccountId: "savings",
      });
      throw new Error("Expected planned expenditure validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetTrackerCommandError);
      expect(formatAssetTrackerError(error)).toBe(
        "Planned expenditure must have a future date",
      );
    }
  });
});

describe("applySetNetWorthTarget", () => {
  it("sets and clears the target while preserving other settings", () => {
    const withTarget = applySetNetWorthTarget(baseData(), { target: 500000 });
    expect(withTarget.settings.targetNetWorth).toEqual({
      amount: 500000,
      currency: "GBP",
    });
    expect(withTarget.settings.targetNetWorthIsReal).toBe(false);
    expect(withTarget.settings.expectedAnnualInflation).toBe(0.025);

    const cleared = applySetNetWorthTarget(withTarget, { target: null });
    expect(cleared.settings.targetNetWorth).toBeUndefined();
    expect(cleared.settings.targetNetWorthIsReal).toBeUndefined();
  });

  it("records that a target is in today's money", () => {
    const next = applySetNetWorthTarget(baseData(), {
      target: 500000,
      inTodaysMoney: true,
    });

    expect(next.settings.targetNetWorth).toEqual({
      amount: 500000,
      currency: "GBP",
    });
    expect(next.settings.targetNetWorthIsReal).toBe(true);
  });

  it("records the base currency with the target", () => {
    const data = baseData();
    data.settings.baseCurrency = "USD";

    const next = applySetNetWorthTarget(data, { target: 600_000 });

    expect(next.settings.targetNetWorth).toEqual({
      amount: 600_000,
      currency: "USD",
    });
  });

  it("rejects a non-positive target", () => {
    expect(() =>
      applySetNetWorthTarget(baseData(), { target: -100 }),
    ).toThrow();
  });
});

describe("applySetExpectedReturn", () => {
  it("records a rate change effective from a date", () => {
    const next = applySetExpectedReturn(baseData(), {
      accountId: "savings",
      rate: 0.05,
      effectiveFrom: "2024-08-01",
    });

    const savings = next.accounts.find((a) => a.id === "savings");
    expect(savings?.expectedReturnChanges).toEqual([
      { date: "2024-08-01", rate: 0.05 },
    ]);
    // The base rate is untouched — history before the change still uses it
    expect(savings?.expectedAnnualReturn).toBe(0.04);
  });

  it("replaces a change on the same date and keeps changes sorted", () => {
    let data = applySetExpectedReturn(baseData(), {
      accountId: "savings",
      rate: 0.05,
      effectiveFrom: "2024-08-01",
    });
    data = applySetExpectedReturn(data, {
      accountId: "savings",
      rate: 0.03,
      effectiveFrom: "2024-02-01",
    });
    data = applySetExpectedReturn(data, {
      accountId: "savings",
      rate: 0.045,
      effectiveFrom: "2024-08-01",
    });

    const savings = data.accounts.find((a) => a.id === "savings");
    expect(savings?.expectedReturnChanges).toEqual([
      { date: "2024-02-01", rate: 0.03 },
      { date: "2024-08-01", rate: 0.045 },
    ]);
  });
});

describe("applySetAccountLiquidity", () => {
  it("updates the access tier without changing the asset type", () => {
    const next = applySetAccountLiquidity(baseData(), {
      accountId: "stocks-isa",
      liquidity: "illiquid",
    });

    const account = next.accounts.find((item) => item.id === "stocks-isa");
    expect(account?.liquidity).toBe("illiquid");
    expect(account?.assetType).toBe("stocks");
  });

  it("rejects making an account illiquid while it funds planned spending", () => {
    const data = applyAddPlannedExpenditure(baseData(), {
      name: "New car",
      amount: 20_000,
      date: "2099-06-01",
      fromAccountId: "stocks-isa",
    });

    expect(() =>
      applySetAccountLiquidity(data, {
        accountId: "stocks-isa",
        liquidity: "illiquid",
      }),
    ).toThrow(/funds planned spending/);
  });
});

describe("applyDeleteSnapshot", () => {
  it("removes the matching snapshot", () => {
    const next = applyDeleteSnapshot(baseData(), {
      accountId: "stocks-isa",
      date: "2024-06-01",
    });

    expect(next.snapshots).toHaveLength(4);
    expect(
      next.snapshots.find(
        (s) => s.accountId === "stocks-isa" && s.date === "2024-06-01",
      ),
    ).toBeUndefined();
  });

  it("rejects when no snapshot matches", () => {
    expect(() =>
      applyDeleteSnapshot(baseData(), {
        accountId: "stocks-isa",
        date: "1999-01-01",
      }),
    ).toThrow(/No balance recorded/);
  });
});

describe("applyClearAccountHistory", () => {
  it("clears only the selected account's balance history", () => {
    const data = baseData();
    const next = applyClearAccountHistory(data, {
      accountId: "stocks-isa",
      kind: "balances",
    });

    expect(next.accounts).toEqual(data.accounts);
    expect(next.snapshots.some((row) => row.accountId === "stocks-isa")).toBe(
      false,
    );
    expect(next.snapshots).toContainEqual({
      accountId: "savings",
      date: "2024-06-01",
      balance: 5000,
    });
  });

  it("clears only the selected account's deposit and withdrawal history", () => {
    const data = applyImportAccountHistory(baseData(), {
      accountId: "stocks-isa",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 500 }],
    });
    const otherAccount = applyImportAccountHistory(data, {
      accountId: "savings",
      balances: [],
      capitalFlows: [{ date: "2024-06-01", value: 100 }],
    });

    const next = applyClearAccountHistory(otherAccount, {
      accountId: "stocks-isa",
      kind: "capitalFlows",
    });

    expect(next.snapshots).toEqual(otherAccount.snapshots);
    expect(next.capitalFlows).toEqual([
      { accountId: "savings", date: "2024-06-01", amount: 100 },
    ]);
  });
});
