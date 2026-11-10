import { describe, expect, it } from "vitest";
import type { AssetTrackerData } from "@/app/_projects/personal-finance-app/domain/assetTrackerData";
import {
  buildRepository,
  getEmptyData,
} from "@/app/_projects/personal-finance-app/domain/assetTrackerRepository";
import { defaultHouseholdFields } from "@/app/_projects/personal-finance-app/domain/household";

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
    planningCases: [],
    futureCashFlows: [],
    forecastAssumptionSets: [],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

describe("buildRepository", () => {
  it("creates a persisted blank slate without demo records", () => {
    const empty = getEmptyData();
    const repository = buildRepository(empty);

    expect(repository.accounts.size).toBe(0);
    expect(repository.snapshots).toEqual([]);
    expect(repository.financialEntities).toHaveLength(1);
    expect(repository.accountOwnerships).toEqual([]);
  });

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
    const account = data.accounts[0];
    if (account == null) throw new Error("fixture has no account");
    data.accounts.push({ ...account, name: "Duplicate" });

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

  it("validates future cash-flow case, account, and currency references", () => {
    const data = repositoryData();
    data.futureCashFlows = [
      {
        id: "future-payment",
        name: "Future payment",
        planningCaseId: "missing-case",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "payment-1",
            direction: "payment",
            fromAccountId: "savings-1",
            dueDate: "2099-01-01",
            amount: 1_000,
            actuals: [],
          },
        ],
      },
    ];

    expect(() => buildRepository(data)).toThrow(/unknown planning case/);
    data.planningCases = [
      {
        id: "missing-case",
        name: "Plans",
        labels: [],
        checklistItems: [],
      },
    ];
    const futureCashFlow = data.futureCashFlows[0];
    if (futureCashFlow == null)
      throw new Error("fixture has no future cash flow");
    data.futureCashFlows[0] = {
      ...futureCashFlow,
      currency: "USD",
    };
    expect(() => buildRepository(data)).toThrow(/must use the currency/);
  });

  it("accepts and orders salary corrections by timestamp instant", () => {
    const data = repositoryData();
    data.salaryHistory = [
      {
        id: "salary-correction",
        person: "Alex Example",
        employer: "Northstar Ltd",
        employmentId: "northstar-engineer",
        currency: "GBP",
        jurisdiction: "UK",
        effectiveStart: "2025-01-01",
        payFrequency: "monthly",
        amountKind: "annualSalary",
        grossPay: 52_000,
        source: { kind: "manual" },
        acceptedAt: "2026-10-04T10:00:00.100Z",
        correctsId: "salary-original",
      },
      {
        id: "salary-original",
        person: "Alex Example",
        employer: "Northstar Ltd",
        employmentId: "northstar-engineer",
        currency: "GBP",
        jurisdiction: "UK",
        effectiveStart: "2025-01-01",
        payFrequency: "monthly",
        amountKind: "annualSalary",
        grossPay: 50_000,
        source: { kind: "manual" },
        acceptedAt: "2026-10-04T10:00:00Z",
      },
    ];

    expect(buildRepository(data).salaryHistory.map(({ id }) => id)).toEqual([
      "salary-original",
      "salary-correction",
    ]);
  });

  it("rejects duplicate dated facts without conflating capital-flow kinds", () => {
    const duplicateSnapshot = repositoryData();
    duplicateSnapshot.snapshots.push({
      accountId: "isa-1",
      date: "2024-06-01",
      balance: 12_500,
    });
    expect(() => buildRepository(duplicateSnapshot)).toThrow(
      /Duplicate snapshot for account "isa-1" on 2024-06-01/,
    );

    const duplicateIncome = repositoryData();
    duplicateIncome.incomeHistory = [
      { date: "2024-06-01", amount: 2_000, currency: "GBP" },
      { date: "2024-06-01", amount: 1_000, currency: "GBP" },
    ];
    expect(() => buildRepository(duplicateIncome)).toThrow(
      /Duplicate income record on 2024-06-01/,
    );

    const classifiedFlows = repositoryData();
    classifiedFlows.capitalFlows = [
      { accountId: "isa-1", date: "2024-06-01", amount: 500 },
      {
        accountId: "isa-1",
        date: "2024-06-01",
        amount: 200,
        kind: "external",
      },
    ];
    expect(() => buildRepository(classifiedFlows)).not.toThrow();
    classifiedFlows.capitalFlows.push({
      accountId: "isa-1",
      date: "2024-06-01",
      amount: 300,
      kind: "external",
    });
    expect(() => buildRepository(classifiedFlows)).toThrow(
      /Duplicate external capital flow/,
    );
  });

  it("enforces recurring-flow currency conversion at the persistence boundary", () => {
    const data = repositoryData();
    data.accounts.push({
      id: "usd-cash",
      name: "US cash",
      provider: "Example Bank",
      currency: "USD",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.recurringFlows = [
      {
        id: "monthly-transfer",
        name: "Monthly transfer",
        fromAccountId: "savings-1",
        toAccountId: "usd-cash",
        amount: 1_000,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2024-07-01",
      },
    ];

    expect(() => buildRepository(data)).toThrow(/needs a currency conversion/);
    const flow = data.recurringFlows[0];
    if (flow == null) throw new Error("fixture has no recurring flow");
    flow.conversion = {
      received: { amount: 1_250, currency: "USD" },
      provider: "Example FX",
    };
    expect(() => buildRepository(data)).not.toThrow();

    flow.conversion.received.currency = "EUR";
    expect(() => buildRepository(data)).toThrow(
      /must receive the destination account currency/,
    );
  });

  it("rejects valuation observations that break identity or correction lineage", () => {
    const data = repositoryData();
    data.instruments = [
      { id: "fund", symbol: "FUND", name: "Index fund", currency: "GBP" },
    ];
    data.holdingObservations = [
      {
        id: "holding-original",
        accountId: "isa-1",
        instrumentId: "fund",
        quantity: 10,
        validAt: "2024-06-01",
        acceptedAt: "2024-06-01T10:00:00.000Z",
        source: { kind: "manual", id: "statement" },
      },
      {
        id: "holding-correction",
        accountId: "savings-1",
        instrumentId: "fund",
        quantity: 11,
        validAt: "2024-06-01",
        acceptedAt: "2024-06-02T10:00:00.000Z",
        source: { kind: "manual", id: "statement" },
        correctsId: "holding-original",
      },
    ];

    expect(() => buildRepository(data)).toThrow(/must correct the same series/);
    const correction = data.holdingObservations[1];
    if (correction == null) throw new Error("fixture has no correction");
    correction.accountId = "isa-1";
    correction.acceptedAt = "2024-05-31T10:00:00.000Z";
    expect(() => buildRepository(data)).toThrow(/must be accepted after/);

    correction.acceptedAt = "2024-06-02T10:00:00.000Z";
    data.priceObservations = [
      {
        id: "holding-correction",
        instrumentId: "fund",
        currency: "GBP",
        price: 100,
        validAt: "2024-06-01",
        acceptedAt: "2024-06-01T10:00:00.000Z",
        source: { kind: "manual", id: "quote" },
      },
    ];
    expect(() => buildRepository(data)).toThrow(
      /Duplicate observation ID "holding-correction"/,
    );
  });

  it("requires one active forecast assumption version with valid lineage", () => {
    const data = repositoryData();
    data.forecastAssumptionSets = [
      {
        id: "baseline-v1",
        seriesId: "baseline",
        name: "Baseline",
        version: 1,
        status: "active",
        createdAt: "2024-01-01T00:00:00.000Z",
        assumptions: [],
      },
      {
        id: "baseline-v2",
        seriesId: "baseline",
        name: "Baseline",
        version: 2,
        status: "active",
        createdAt: "2024-02-01T00:00:00.000Z",
        supersedesId: "baseline-v1",
        assumptions: [],
      },
    ];

    expect(() => buildRepository(data)).toThrow(/more than one active version/);
    const first = data.forecastAssumptionSets[0];
    const second = data.forecastAssumptionSets[1];
    if (first == null || second == null)
      throw new Error("fixture has no assumption versions");
    first.status = "superseded";
    second.supersedesId = "missing-version";
    expect(() => buildRepository(data)).toThrow(/supersedes unknown version/);
  });
});
