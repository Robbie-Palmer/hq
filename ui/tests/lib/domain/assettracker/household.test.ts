import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  applyAddHouseholdMember,
  applyImportAccountHistory,
  applyImportIncomeHistory,
  applyRenameHouseholdMember,
  applySetAccountOwnership,
  applySetActiveHouseholdScope,
  buildRepository,
  capitalFlowOwnershipKey,
  defaultHouseholdFields,
  equalSharedOwnership,
  getNetWorthTimeSeries,
  migrateHouseholdOwnership,
  OwnershipSchema,
  ownershipLabel,
  ownershipShare,
  personalOwnership,
  scopeAssetTrackerData,
  snapshotOwnershipKey,
  validateHouseholdOwnership,
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

  it("keeps future cash-flow ownership tied to its first-stage account", () => {
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
      accounts: [
        migrated.accounts[0],
        {
          id: "sam-cash",
          name: "Sam cash",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2025-01-01",
        },
      ],
      futureCashFlows: [
        {
          id: "staged-commitment",
          name: "Staged commitment",
          kind: "commitment",
          currency: "GBP",
          stages: [
            {
              id: "deposit",
              fromAccountId: "cash",
              dueDate: "2025-12-01",
              amount: 500,
            },
            {
              id: "balance",
              fromAccountId: "sam-cash",
              dueDate: "2026-01-01",
              amount: 1_000,
            },
          ],
        },
      ],
      ownership: {
        ...migrated.ownership,
        accounts: {
          cash: personalOwnership("primary"),
          "sam-cash": personalOwnership("sam"),
        },
        futureCashFlows: {
          "staged-commitment": personalOwnership("primary"),
        },
      },
    });
    const shared = equalSharedOwnership(data.household.members);

    const laterStageUpdated = applySetAccountOwnership(data, {
      accountId: "sam-cash",
      ownership: shared,
    });
    const firstStageUpdated = applySetAccountOwnership(data, {
      accountId: "cash",
      ownership: shared,
    });

    expect(
      laterStageUpdated.ownership.futureCashFlows["staged-commitment"],
    ).toEqual(personalOwnership("primary"));
    expect(
      firstStageUpdated.ownership.futureCashFlows["staged-commitment"],
    ).toEqual(shared);
  });

  it("removes scoped references to accounts and future cash flows that were dropped", () => {
    const migrated = AssetTrackerDataSchema.parse(oldSinglePersonData());
    const data = AssetTrackerDataSchema.parse({
      ...migrated,
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "member", memberId: "sam" },
      },
      accounts: [
        migrated.accounts[0],
        {
          id: "sam-cash",
          name: "Sam cash",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2025-01-01",
        },
      ],
      futureCashFlows: [
        {
          id: "primary-commitment",
          name: "Primary commitment",
          kind: "commitment",
          currency: "GBP",
          stages: [
            {
              id: "payment",
              fromAccountId: "cash",
              dueDate: "2025-12-01",
              amount: 500,
            },
          ],
        },
        {
          id: "sam-decision",
          name: "Sam decision",
          kind: "decision",
          currency: "GBP",
          dependencyIds: ["primary-commitment"],
          alternativeToIds: ["primary-commitment"],
          stages: [
            {
              id: "choice",
              fromAccountId: "sam-cash",
              expectedDate: "2025-12-01",
              minimumAmount: 100,
              expectedAmount: 200,
              maximumAmount: 300,
            },
          ],
        },
      ],
      forecastAssumptionSets: [
        {
          id: "shared-income-v1",
          seriesId: "shared-income",
          name: "Shared income",
          version: 1,
          status: "active",
          createdAt: "2025-01-31T12:00:00Z",
          assumptions: [
            {
              id: "income-change",
              name: "Income change",
              kind: "income",
              startDate: "2025-06-01",
              monthlyChange: {
                minimum: 100,
                expected: 200,
                maximum: 300,
              },
              currency: "GBP",
              ownership: {
                kind: "shared",
                shares: [
                  { memberId: "primary", share: 0.5 },
                  { memberId: "sam", share: 0.5 },
                ],
              },
              accountId: "cash",
              source: { kind: "manual-take-home" },
            },
          ],
        },
      ],
      ownership: {
        ...migrated.ownership,
        accounts: {
          cash: personalOwnership("primary"),
          "sam-cash": personalOwnership("sam"),
        },
      },
    });

    const scoped = scopeAssetTrackerData(data);

    expect(scoped.futureCashFlows).toMatchObject([
      {
        id: "sam-decision",
        dependencyIds: [],
        alternativeToIds: [],
      },
    ]);
    expect(scoped.forecastAssumptionSets[0]?.assumptions).toEqual([]);
    expect(() => buildRepository(scoped)).not.toThrow();
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

  it("validates shared ownership and formats known and unknown owners", () => {
    expect(
      OwnershipSchema.safeParse({
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.5 },
          { memberId: "alex", share: 0.5 },
        ],
      }).success,
    ).toBe(false);
    expect(
      OwnershipSchema.safeParse({
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.6 },
          { memberId: "sam", share: 0.3 },
        ],
      }).success,
    ).toBe(false);

    expect(equalSharedOwnership([])).toEqual(personalOwnership("primary"));
    expect(equalSharedOwnership([{ id: "alex", displayName: "Alex" }])).toEqual(
      personalOwnership("alex"),
    );
    expect(ownershipShare(personalOwnership("alex"), "sam")).toBe(0);
    expect(
      ownershipShare(
        {
          kind: "shared",
          shares: [
            { memberId: "alex", share: 0.75 },
            { memberId: "sam", share: 0.25 },
          ],
        },
        "jo",
      ),
    ).toBe(0);
    expect(
      ownershipLabel(personalOwnership("missing"), [
        { id: "alex", displayName: "Alex" },
      ]),
    ).toBe("Unknown member");
    expect(
      ownershipLabel(
        {
          kind: "shared",
          shares: [
            { memberId: "alex", share: 0.75 },
            { memberId: "missing", share: 0.25 },
          ],
        },
        [{ id: "alex", displayName: "Alex" }],
      ),
    ).toBe("Alex 75%, Unknown member 25%");
  });

  it("keeps stable member IDs and rejects references outside the roster", () => {
    const original = AssetTrackerDataSchema.parse(oldSinglePersonData());
    const sam = applyAddHouseholdMember(original, { displayName: "Sam" });
    const sam2 = applyAddHouseholdMember(sam, { displayName: "Sam" });
    const sam3 = applyAddHouseholdMember(sam2, { displayName: "Sam" });
    const symbol = applyAddHouseholdMember(sam3, { displayName: "✨" });
    const renamed = applyRenameHouseholdMember(symbol, {
      memberId: "sam",
      displayName: "Samantha",
    });

    expect(renamed.household.members).toEqual([
      { id: "primary", displayName: "Me" },
      { id: "sam", displayName: "Samantha" },
      { id: "sam-2", displayName: "Sam" },
      { id: "sam-3", displayName: "Sam" },
      { id: "member", displayName: "✨" },
    ]);
    expect(
      applySetActiveHouseholdScope(renamed, {
        kind: "member",
        memberId: "sam",
      }).household.activeScope,
    ).toEqual({ kind: "member", memberId: "sam" });
    expect(
      applySetActiveHouseholdScope(renamed, { kind: "household" }).household
        .activeScope,
    ).toEqual({ kind: "household" });

    expect(() =>
      applyRenameHouseholdMember(renamed, {
        memberId: "missing",
        displayName: "Nobody",
      }),
    ).toThrow('Unknown household member "missing"');
    expect(() =>
      applySetActiveHouseholdScope(renamed, {
        kind: "member",
        memberId: "missing",
      }),
    ).toThrow('Unknown household member "missing"');
    expect(() =>
      applySetAccountOwnership(renamed, {
        accountId: "missing",
        ownership: personalOwnership("sam"),
      }),
    ).toThrow('Unknown account "missing"');
    expect(() =>
      applySetAccountOwnership(renamed, {
        accountId: "cash",
        ownership: personalOwnership("missing"),
      }),
    ).toThrow('Ownership references unknown household member "missing"');
  });

  it("migrates every record family from its related account owner", () => {
    const fields = defaultHouseholdFields();
    const migrated = migrateHouseholdOwnership({
      ...fields,
      accounts: [{ id: "cash" }],
      snapshots: [{ accountId: "cash", date: "2025-01-31" }],
      capitalFlows: [{ accountId: "cash", date: "2025-01-15" }],
      incomeHistory: [{ date: "2025-01-31" }],
      transfers: [
        { id: "incoming", toAccountId: "cash" },
        { id: "outgoing", fromAccountId: "cash" },
        { id: "unlinked" },
      ],
      recurringFlows: [
        { id: "salary", toAccountId: "cash" },
        { id: "spending", fromAccountId: "cash" },
      ],
      plannedExpenditures: [{ id: "holiday", fromAccountId: "cash" }],
      futureCashFlows: [],
      holdingObservations: [{ id: "holding", accountId: "cash" }],
    });

    for (const collection of Object.values(migrated.ownership)) {
      for (const ownership of Object.values(collection)) {
        expect(ownership).toEqual(personalOwnership("primary"));
      }
    }
  });

  it("scales shared transfers, recurring flows, plans, and holdings", () => {
    const shared = {
      kind: "shared" as const,
      shares: [
        { memberId: "primary", share: 0.6 },
        { memberId: "sam", share: 0.4 },
      ],
    };
    const data = AssetTrackerDataSchema.parse({
      ...oldSinglePersonData(),
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "member", memberId: "sam" },
      },
      accounts: [
        oldSinglePersonData().accounts[0],
        {
          id: "stocks",
          name: "Stocks",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.05,
          linkedAccountId: "cash",
          createdAt: "2025-01-01",
        },
      ],
      snapshots: [
        { accountId: "cash", date: "2025-01-31", balance: 1_000 },
        { accountId: "stocks", date: "2025-01-31", balance: 2_000 },
      ],
      capitalFlows: [{ accountId: "cash", date: "2025-01-15", amount: 200 }],
      transfers: [
        {
          id: "transfer",
          date: "2025-01-20",
          fromAccountId: "cash",
          toAccountId: "stocks",
          amount: 100,
          fromAmount: 110,
          toAmount: 95,
          feeAmount: 5,
        },
      ],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "cash",
          amount: 500,
          grossAmount: 600,
          compensationKind: "takeHomeIncome",
          currency: "GBP",
          frequency: "monthly",
          startDate: "2025-01-01",
        },
      ],
      plannedExpenditures: [
        {
          id: "holiday",
          name: "Holiday",
          amount: 1_000,
          date: "2025-12-01",
          fromAccountId: "cash",
        },
      ],
      forecastAssumptionSets: [
        {
          id: "household-v1",
          seriesId: "household",
          name: "Household",
          version: 1,
          status: "active",
          createdAt: "2025-01-31T12:00:00Z",
          assumptions: [
            {
              id: "temporary-cost",
              name: "Temporary cost",
              kind: "expenditure",
              startDate: "2025-06-01",
              monthlyChange: {
                minimum: 100,
                expected: 200,
                maximum: 300,
              },
              currency: "GBP",
              ownership: shared,
              source: { kind: "manual" },
            },
          ],
        },
      ],
      instruments: [
        { id: "fund", symbol: "FUND", name: "Fund", currency: "GBP" },
      ],
      holdingObservations: [
        {
          id: "holding",
          accountId: "stocks",
          instrumentId: "fund",
          quantity: 10,
          validAt: "2025-01-31",
          acceptedAt: "2025-01-31T12:00:00Z",
          source: { kind: "manual", id: "test" },
        },
      ],
      ownership: {
        accounts: { cash: shared, stocks: shared },
        snapshots: {
          [snapshotOwnershipKey("cash", "2025-01-31")]: shared,
          [snapshotOwnershipKey("stocks", "2025-01-31")]: shared,
        },
        capitalFlows: {
          [capitalFlowOwnershipKey({
            accountId: "cash",
            date: "2025-01-15",
          })]: shared,
        },
        incomeHistory: { "2025-01-31": shared },
        transfers: { transfer: shared },
        recurringFlows: { salary: shared },
        plannedExpenditures: { holiday: shared },
        holdingObservations: { holding: shared },
      },
    });

    const scoped = scopeAssetTrackerData(data);
    const reassigned = applySetAccountOwnership(data, {
      accountId: "stocks",
      ownership: personalOwnership("primary"),
    });
    const cashReassigned = applySetAccountOwnership(data, {
      accountId: "cash",
      ownership: personalOwnership("primary"),
    });

    expect(scoped.snapshots.map(({ balance }) => balance)).toEqual([400, 800]);
    expect(scoped.capitalFlows[0]?.amount).toBe(80);
    expect(scoped.incomeHistory[0]?.amount).toBe(1_200);
    expect(scoped.transfers[0]).toMatchObject({
      amount: 40,
      fromAmount: 44,
      toAmount: 38,
      feeAmount: 2,
    });
    expect(scoped.recurringFlows[0]).toMatchObject({
      amount: 200,
      grossAmount: 240,
    });
    expect(scoped.plannedExpenditures[0]?.amount).toBe(400);
    const scopedCommitment = scoped.futureCashFlows[0];
    expect(scopedCommitment?.kind).toBe("commitment");
    if (scopedCommitment?.kind !== "commitment") {
      throw new Error("fixture has no migrated commitment");
    }
    expect(scopedCommitment.stages[0]?.amount).toBe(400);
    expect(scoped.forecastAssumptionSets[0]?.assumptions[0]).toMatchObject({
      monthlyChange: { minimum: 40, expected: 80, maximum: 120 },
      ownership: personalOwnership("sam"),
    });
    expect(scoped.holdingObservations?.[0]?.quantity).toBe(4);
    expect(reassigned.ownership.holdingObservations.holding).toEqual(
      personalOwnership("primary"),
    );
    expect(cashReassigned.ownership.plannedExpenditures.holiday).toEqual(
      personalOwnership("primary"),
    );
    expect(cashReassigned.ownership.futureCashFlows.holiday).toEqual(
      personalOwnership("primary"),
    );
  });

  it("rejects duplicate, inactive, and unknown household references", () => {
    const data = AssetTrackerDataSchema.parse(oldSinglePersonData());
    expect(() =>
      validateHouseholdOwnership({
        ...data,
        household: {
          members: [
            { id: "primary", displayName: "Alex" },
            { id: "primary", displayName: "Sam" },
          ],
          activeScope: { kind: "household" },
        },
      }),
    ).toThrow("Household member IDs must be unique");
    expect(() =>
      validateHouseholdOwnership({
        ...data,
        household: {
          ...data.household,
          activeScope: { kind: "member", memberId: "missing" },
        },
      }),
    ).toThrow('Ownership references unknown household member "missing"');
    expect(() =>
      validateHouseholdOwnership({
        ...data,
        ownership: {
          ...data.ownership,
          accounts: { cash: personalOwnership("missing") },
        },
      }),
    ).toThrow('Ownership references unknown household member "missing"');
  });
});
