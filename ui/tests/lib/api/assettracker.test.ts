import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSET_TRACKER_STORAGE_KEY,
  createLocalAssetTrackerApi,
} from "@/lib/api/assettracker";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";

describe("createLocalAssetTrackerApi", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function createApi() {
    return createLocalAssetTrackerApi(window.localStorage);
  }

  it("loads the seed data when nothing is stored", async () => {
    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(false);
    expect(data).toEqual(getDemoAssetTrackerData());
  });

  it("persists mutations across instances", async () => {
    const seed = getDemoAssetTrackerData();
    const accountId = seed.accounts.find((a) => !a.closedAt)?.id;
    if (!accountId) throw new Error("seed data has no open account");

    await createApi().recordBalance({
      accountId,
      date: "2025-06-01",
      balance: 42000,
    });

    const { data, persisted } = await createApi().load();
    expect(persisted).toBe(true);
    expect(data.snapshots).toContainEqual({
      accountId,
      date: "2025-06-01",
      balance: 42000,
    });
  });

  it("persists created accounts", async () => {
    const seed = getDemoAssetTrackerData();
    await createApi().createAccount({
      name: "Premium Bonds",
      provider: "NS&I",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0.04,
      openingBalance: 5000,
      openingDate: "2025-01-01",
    });

    const { data } = await createApi().load();
    expect(data.accounts).toHaveLength(seed.accounts.length + 1);
    expect(data.accounts.map((a) => a.id)).toContain("premium-bonds");
  });

  it("persists an atomic account-history import", async () => {
    const seed = getDemoAssetTrackerData();
    const accountId = seed.accounts.find((account) => !account.closedAt)?.id;
    if (!accountId) throw new Error("seed data has no open account");

    await createApi().importAccountHistory({
      accountId,
      balances: [{ date: "2025-01-31", value: 15000 }],
      capitalFlows: [{ date: "2025-01-31", value: 500 }],
    });

    const { data } = await createApi().load();
    expect(data.snapshots).toContainEqual({
      accountId,
      date: "2025-01-31",
      balance: 15000,
    });
    expect(data.capitalFlows).toContainEqual({
      accountId,
      date: "2025-01-31",
      amount: 500,
    });
  });

  it("persists clearing one account history without removing the account", async () => {
    const api = createApi();
    const seed = getDemoAssetTrackerData();
    const accountId = seed.snapshots[0]?.accountId;
    if (!accountId) throw new Error("seed data has no balance history");

    await api.clearAccountHistory({ accountId, kind: "balances" });

    const { data } = await createApi().load();
    expect(data.accounts.some((account) => account.id === accountId)).toBe(
      true,
    );
    expect(data.snapshots.some((row) => row.accountId === accountId)).toBe(
      false,
    );
    expect(data.snapshots.some((row) => row.accountId !== accountId)).toBe(
      true,
    );
  });

  it("falls back to seed data when stored JSON is corrupt", async () => {
    window.localStorage.setItem(ASSET_TRACKER_STORAGE_KEY, "{not json");

    const { data, persisted } = await createApi().load();
    expect(persisted).toBe(false);
    expect(data).toEqual(getDemoAssetTrackerData());
  });

  it("falls back to seed data when stored data fails validation", async () => {
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify({ accounts: [{ id: "broken" }], snapshots: [] }),
    );

    const { persisted } = await createApi().load();
    expect(persisted).toBe(false);
  });

  it("loads older saved data with no capital-flow collection", async () => {
    const { capitalFlows: _capitalFlows, ...legacy } =
      getDemoAssetTrackerData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.capitalFlows).toEqual([]);
  });

  it("loads older saved data with no income history", async () => {
    const { incomeHistory: _incomeHistory, ...legacy } =
      getDemoAssetTrackerData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.incomeHistory).toEqual([]);
  });

  it("migrates old saved data to one stable local household member", async () => {
    const seed = getDemoAssetTrackerData();
    const { household: _household, ownership: _ownership, ...legacy } = seed;
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.household.members).toEqual([
      { id: "primary", displayName: "Me" },
    ]);
    expect(data.accounts).toEqual(seed.accounts);
    const firstAccount = data.accounts[0];
    if (firstAccount == null) throw new Error("Seed has no account");
    expect(data.ownership.accounts[firstAccount.id]).toEqual({
      kind: "personal",
      memberId: "primary",
    });
  });

  it("persists household members, display names, scope, and account ownership", async () => {
    const api = createApi();
    await api.addHouseholdMember({ displayName: "Jordan" });
    await api.renameHouseholdMember({
      memberId: "alex",
      displayName: "Alexandra",
    });
    await api.setActiveHouseholdScope({ kind: "member", memberId: "jordan" });
    const accountId = getDemoAssetTrackerData().accounts[0]?.id;
    if (accountId == null) throw new Error("Seed has no account");
    await api.setAccountOwnership({
      accountId,
      ownership: {
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.6 },
          { memberId: "jordan", share: 0.4 },
        ],
      },
    });

    const { data } = await createApi().load();
    expect(data.household).toEqual({
      members: [
        { id: "alex", displayName: "Alexandra" },
        { id: "sam", displayName: "Sam" },
        { id: "jordan", displayName: "Jordan" },
      ],
      activeScope: { kind: "member", memberId: "jordan" },
    });
    expect(data.ownership.accounts[accountId]).toEqual({
      kind: "shared",
      shares: [
        { memberId: "alex", share: 0.6 },
        { memberId: "jordan", share: 0.4 },
      ],
    });
  });

  it("loads older saved data with no planned expenditures", async () => {
    const { plannedExpenditures: _plannedExpenditures, ...legacy } =
      getDemoAssetTrackerData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.plannedExpenditures).toEqual([]);
  });

  it("defaults the withdrawal rate in older saved settings", async () => {
    const seed = getDemoAssetTrackerData();
    const legacy = {
      ...seed,
      settings: {
        expectedAnnualInflation: seed.settings.expectedAnnualInflation,
      },
    };
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.settings.withdrawalRate).toBe(0.04);
    expect(data.settings.baseCurrency).toBe("GBP");
    expect(data.settings.valuationMaxAgeDays).toBe(7);
  });

  it("persists the household base currency", async () => {
    await createApi().setBaseCurrency({ currency: "USD" });

    const { data } = await createApi().load();

    expect(data.settings.baseCurrency).toBe("USD");
  });

  it("repairs duplicate persisted income dates without hiding the portfolio", async () => {
    const seed = getDemoAssetTrackerData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify({
        ...seed,
        incomeHistory: [
          { date: "2025-01-31", amount: 4_100 },
          { date: "2025-01-31", amount: 4_200 },
        ],
      }),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.accounts).toEqual(seed.accounts);
    expect(data.incomeHistory).toEqual([
      { date: "2025-01-31", amount: 4_200, currency: "GBP" },
    ]);
  });

  it("persists portfolio income history and the withdrawal rate", async () => {
    const api = createApi();
    await api.importIncomeHistory({
      income: [{ date: "2025-01-31", amount: 4_500 }],
    });
    await api.setWithdrawalRate({ rate: 0.035 });

    const { data } = await createApi().load();
    expect(data.incomeHistory).toEqual([
      { date: "2025-01-31", amount: 4_500, currency: "GBP" },
    ]);
    expect(data.settings.withdrawalRate).toBe(0.035);
  });

  it("persists planned expenditures", async () => {
    const api = createApi();
    const source = getDemoAssetTrackerData().accounts.find(
      (account) => account.id === "nationwide-current",
    );
    if (!source) throw new Error("seed data has no current account");

    await api.addPlannedExpenditure({
      name: "Wedding",
      amount: 15_000,
      date: "2099-08-01",
      fromAccountId: source.id,
    });

    const { data } = await createApi().load();
    expect(data.plannedExpenditures).toContainEqual({
      id: "wedding",
      name: "Wedding",
      amount: 15_000,
      date: "2099-08-01",
      fromAccountId: source.id,
    });

    const withoutExpenditure = await api.deletePlannedExpenditure({
      id: "wedding",
    });
    expect(withoutExpenditure.plannedExpenditures).toEqual([]);
  });

  it("persists transfers and history deletions", async () => {
    const api = createApi();
    const seed = getDemoAssetTrackerData();
    const accountId = seed.accounts.find((account) => !account.closedAt)?.id;
    if (!accountId) throw new Error("seed data has no open account");

    const transferred = await api.recordTransfer({
      date: "2099-01-01",
      toAccountId: accountId,
      amount: 100,
    });
    expect(transferred.transfers).toContainEqual(
      expect.objectContaining({ toAccountId: accountId, amount: 100 }),
    );

    const withoutSnapshot = await api.deleteSnapshot({
      accountId,
      date: "2099-01-01",
    });
    expect(withoutSnapshot.snapshots).not.toContainEqual(
      expect.objectContaining({ accountId, date: "2099-01-01" }),
    );

    await api.importAccountHistory({
      accountId,
      capitalFlows: [{ date: "2098-01-01", value: 50 }],
      balances: [],
    });
    const withoutCapitalFlow = await api.deleteCapitalFlow({
      accountId,
      date: "2098-01-01",
    });
    expect(withoutCapitalFlow.capitalFlows).not.toContainEqual(
      expect.objectContaining({ accountId, date: "2098-01-01" }),
    );

    const withoutIncome = await api.clearIncomeHistory();
    expect(withoutIncome.incomeHistory).toEqual([]);
  });

  it("persists account lifecycle and portfolio settings", async () => {
    const api = createApi();
    const accountId = getDemoAssetTrackerData().accounts.find(
      (account) => !account.closedAt,
    )?.id;
    if (!accountId) throw new Error("seed data has no open account");

    await api.setExpectedReturn({
      accountId,
      rate: 0.05,
      effectiveFrom: "2099-01-01",
    });
    await api.setAccountLiquidity({ accountId, liquidity: "liquid" });
    await api.setInflation({ rate: 0.025 });
    const configured = await api.setNetWorthTarget({
      target: 1_000_000,
      inTodaysMoney: true,
    });
    expect(configured.settings).toMatchObject({
      expectedAnnualInflation: 0.025,
      targetNetWorth: { amount: 1_000_000, currency: "GBP" },
      targetNetWorthIsReal: true,
    });

    await api.createAccount({
      name: "Temporary account",
      provider: "Test provider",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0,
    });
    const closed = await api.closeAccount({
      accountId: "temporary-account",
      closedAt: "2099-01-01",
    });
    expect(
      closed.accounts.find((account) => account.id === "temporary-account"),
    ).toMatchObject({ closedAt: "2099-01-01" });
  });

  it("persists and materializes recurring flows", async () => {
    const api = createApi();
    const accountId = getDemoAssetTrackerData().accounts.find(
      (account) => !account.closedAt,
    )?.id;
    if (!accountId) throw new Error("seed data has no open account");

    const withFlow = await api.addRecurringFlow({
      name: "Test income",
      toAccountId: accountId,
      amount: 100,
      frequency: "monthly",
      startDate: "2099-01-01",
    });
    expect(withFlow.recurringFlows).toContainEqual(
      expect.objectContaining({ id: "test-income" }),
    );

    const materialized = await api.materializeFlow({
      flowId: "test-income",
      throughDate: "2099-02-01",
    });
    expect(
      materialized.transfers.filter(
        (transfer) => transfer.flowId === "test-income",
      ),
    ).toHaveLength(2);

    const withoutFlow = await api.deleteRecurringFlow({ id: "test-income" });
    expect(withoutFlow.recurringFlows).not.toContainEqual(
      expect.objectContaining({ id: "test-income" }),
    );
  });

  it("rejects importing data that fails validation", async () => {
    await expect(
      createApi().importData({ accounts: "nope" }),
    ).rejects.toThrow();
  });

  it("rejects importing data with orphan snapshots", async () => {
    await expect(
      createApi().importData({
        accounts: [],
        snapshots: [{ accountId: "ghost", date: "2024-01-01", balance: 1 }],
      }),
    ).rejects.toThrow(/unknown account/);
  });

  it("imports and persists a valid export", async () => {
    const exported = getDemoAssetTrackerData();
    const imported = await createApi().importData(exported);

    expect(imported).toEqual(exported);
    const { persisted } = await createApi().load();
    expect(persisted).toBe(true);
  });

  it("reset clears stored data and returns the seed", async () => {
    const api = createApi();
    const seed = getDemoAssetTrackerData();
    const accountId = seed.accounts.find((a) => !a.closedAt)?.id;
    if (!accountId) throw new Error("seed data has no open account");
    await api.recordBalance({ accountId, date: "2025-06-01", balance: 1 });

    const data = await api.reset();

    expect(data).toEqual(seed);
    expect(window.localStorage.getItem(ASSET_TRACKER_STORAGE_KEY)).toBeNull();
    const { persisted } = await createApi().load();
    expect(persisted).toBe(false);
  });

  it("persists a blank slate instead of falling back to the demo seed", async () => {
    const data = await createApi().clear();

    expect(data.accounts).toEqual([]);
    expect(data.snapshots).toEqual([]);
    expect(data.capitalFlows).toEqual([]);

    const loaded = await createApi().load();
    expect(loaded.persisted).toBe(true);
    expect(loaded.data).toEqual(data);
  });
});
