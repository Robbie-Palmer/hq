import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSET_TRACKER_STORAGE_KEY,
  createLocalAssetTrackerApi,
} from "@/lib/api/assettracker";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import { AssetTrackerDataSchema } from "@/lib/domain/assettracker";

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

  it("persists mortgage scenarios with linked decision records", async () => {
    const seed = getDemoAssetTrackerData();
    await createApi().saveMortgageScenario({
      name: "Two-year fix",
      recordDecision: true,
      source: {
        mortgageAccountId: "home-mortgage",
        propertyAccountId: "home",
        snapshotDate: "2026-01-31",
      },
      assumptions: {
        purchasePrice: 350_000,
        availableFunds: 150_000,
        depositAmount: 100_000,
        initialAnnualRate: 0.04,
        termMonths: 240,
        repaymentType: "repayment",
        accrualStartDate: "2026-01-31",
        firstPaymentDate: "2026-02-28",
        fixedPeriodEnd: "2031-02-28",
        followOnAnnualRate: 0.055,
        refinanceFee: 999,
        purchaseFees: 500,
        taxes: 7_500,
        transactionCosts: 2_000,
        monthlyOverpayment: 250,
        overpaymentAllowance: 25_000,
        overpaymentChargeRate: 0.05,
      },
    });

    const { data } = await createApi().load();
    expect(data.mortgageScenarios).toHaveLength(
      (seed.mortgageScenarios?.length ?? 0) + 1,
    );
    expect(data.mortgageScenarios).toContainEqual(
      expect.objectContaining({
        id: "two-year-fix",
        name: "Two-year fix",
        decisionRecordId: "two-year-fix-decision",
        source: {
          mortgageAccountId: "home-mortgage",
          propertyAccountId: "home",
          snapshotDate: "2026-01-31",
        },
      }),
    );
    expect(data.decisionRecords).toHaveLength(
      (seed.decisionRecords?.length ?? 0) + 1,
    );
    expect(data.decisionRecords).toContainEqual({
      id: "two-year-fix-decision",
      kind: "mortgage",
      title: "Two-year fix",
      scenarioId: "two-year-fix",
      recordedAt: expect.any(String),
      status: "recorded",
    });
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

  it("rejects corrupt stored JSON without overwriting it", async () => {
    const corrupt = "{not json";
    window.localStorage.setItem(ASSET_TRACKER_STORAGE_KEY, corrupt);

    const api = createApi();
    await expect(api.load()).rejects.toThrow();
    await expect(
      api.createAccount({
        name: "Must not replace saved data",
        provider: "Test provider",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0,
      }),
    ).rejects.toThrow();
    expect(window.localStorage.getItem(ASSET_TRACKER_STORAGE_KEY)).toBe(
      corrupt,
    );
  });

  it("rejects stored data that fails validation", async () => {
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify({ accounts: [{ id: "broken" }], snapshots: [] }),
    );

    await expect(createApi().load()).rejects.toThrow();
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

  it("loads older saved data with no salary history", async () => {
    const { salaryHistory: _salaryHistory, ...legacy } =
      getDemoAssetTrackerData();
    window.localStorage.setItem(
      ASSET_TRACKER_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    const { data, persisted } = await createApi().load();

    expect(persisted).toBe(true);
    expect(data.salaryHistory).toEqual([]);
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

  it("round-trips salary provenance and prior accepted facts", async () => {
    const api = createApi();
    const seededSalaryCount = getDemoAssetTrackerData().salaryHistory.length;
    const original = {
      id: "salary-fixture-2",
      person: "Alex Example",
      employer: "Northstar Ltd",
      employmentId: "northstar-engineer",
      currency: "GBP" as const,
      jurisdiction: "UK",
      effectiveStart: "2021-04-01",
      effectiveEnd: "2021-09-30",
      payFrequency: "monthly" as const,
      amountKind: "annualSalary" as const,
      grossPay: 48_000,
      source: {
        kind: "file" as const,
        fileName: "salary.csv",
        fingerprint: "fixture",
        row: 2,
      },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    await api.importSalaryHistory({ records: [original] });
    await api.importSalaryHistory({ records: [original] });
    const corrected = await api.saveSalaryRecord({
      correctsId: original.id,
      facts: {
        person: original.person,
        employer: original.employer,
        employmentId: original.employmentId,
        currency: original.currency,
        jurisdiction: original.jurisdiction,
        effectiveStart: original.effectiveStart,
        effectiveEnd: original.effectiveEnd,
        payFrequency: original.payFrequency,
        amountKind: original.amountKind,
        grossPay: 50_000,
      },
    });

    expect(corrected.salaryHistory).toHaveLength(seededSalaryCount + 2);
    expect(corrected.salaryHistory).toContainEqual(original);
    const restored = await createApi().importData(
      JSON.parse(JSON.stringify(corrected)),
    );
    expect(restored.salaryHistory).toEqual(corrected.salaryHistory);
  });

  it("stores an explicit no-pension answer in a rollback-compatible form", async () => {
    const seed = getDemoAssetTrackerData();
    const api = createApi();
    await api.saveSalaryRecord({
      facts: {
        person: "Alex Example",
        employer: "Northstar Ltd",
        employmentId: "northstar-engineer",
        currency: "GBP",
        jurisdiction: "England",
        effectiveStart: "2015-07-01",
        payFrequency: "monthly",
        amountKind: "annualSalary",
        grossPay: 48_000,
        employeePension: { arrangement: "none", basis: "unknown" },
        employerPension: { arrangement: "none", basis: "unknown" },
      },
    });

    const raw = window.localStorage.getItem(ASSET_TRACKER_STORAGE_KEY);
    if (raw == null) throw new Error("Expected saved Asset Tracker data");
    const stored = AssetTrackerDataSchema.parse(JSON.parse(raw));
    const storedRecord = stored.salaryHistory.at(-1);
    expect(storedRecord?.employeePension?.arrangement).toBe("unknown");
    expect(storedRecord?.employerPension?.arrangement).toBe("unknown");

    const { data } = await api.load();
    const restored = data.salaryHistory.at(-1);
    expect(data.salaryHistory).toHaveLength(seed.salaryHistory.length + 1);
    expect(restored?.employeePension?.arrangement).toBe("none");
    expect(restored?.employerPension?.arrangement).toBe("none");
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
