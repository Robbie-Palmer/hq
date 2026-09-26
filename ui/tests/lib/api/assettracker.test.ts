import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSET_TRACKER_STORAGE_KEY,
  createLocalAssetTrackerApi,
} from "@/lib/api/assettracker";
import { getSeedData } from "@/lib/domain/assettracker";

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
    expect(data).toEqual(getSeedData());
  });

  it("persists mutations across instances", async () => {
    const seed = getSeedData();
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
    const seed = getSeedData();
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
    const seed = getSeedData();
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
    const seed = getSeedData();
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
    expect(data).toEqual(getSeedData());
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
    const { capitalFlows: _capitalFlows, ...legacy } = getSeedData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.capitalFlows).toEqual([]);
  });

  it("loads older saved data with no income history", async () => {
    const { incomeHistory: _incomeHistory, ...legacy } = getSeedData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.incomeHistory).toEqual([]);
  });

  it("loads older saved data with no planned expenditures", async () => {
    const { plannedExpenditures: _plannedExpenditures, ...legacy } =
      getSeedData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.plannedExpenditures).toEqual([]);
  });

  it("defaults the withdrawal rate in older saved settings", async () => {
    const seed = getSeedData();
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
    const seed = getSeedData();
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
    const source = getSeedData().accounts.find(
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
    const exported = getSeedData();
    const imported = await createApi().importData(exported);

    expect(imported).toEqual(exported);
    const { persisted } = await createApi().load();
    expect(persisted).toBe(true);
  });

  it("reset clears stored data and returns the seed", async () => {
    const api = createApi();
    const seed = getSeedData();
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
