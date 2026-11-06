import { describe, expect, it } from "vitest";
import {
  ASSET_TRACKER_BACKUP_FORMAT,
  AssetTrackerDataSchema,
  accountOwnershipAt,
  buildRepository,
  consolidateHouseholdWealth,
  createAssetTrackerBackup,
  legacyPersonEntityId,
  parseAssetTrackerBackup,
  previewAssetTrackerBackup,
  shareOwnershipAt,
} from "@/app/_projects/personal-finance-app/domain";
import { businessWealthFixture } from "@/app/_projects/personal-finance-app/tests/fixtures/businessWealth";

const accountValues = [
  {
    recordId: "alex-cash-value",
    accountId: "alex-cash",
    validAt: "2026-09-30",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    amount: {
      state: "known" as const,
      currency: "GBP" as const,
      amount: 20_000,
    },
  },
  {
    recordId: "shared-cash-value",
    accountId: "shared-cash",
    validAt: "2026-09-30",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    amount: {
      state: "known" as const,
      currency: "GBP" as const,
      amount: 10_000,
    },
  },
  {
    recordId: "company-cash-value",
    accountId: "company-cash",
    validAt: "2026-09-30",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    amount: {
      state: "known" as const,
      currency: "GBP" as const,
      amount: 250_000,
    },
  },
  {
    recordId: "company-loan-value",
    accountId: "company-loan",
    validAt: "2026-09-30",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    amount: {
      state: "known" as const,
      currency: "GBP" as const,
      amount: 50_000,
    },
  },
];

function consolidate(asKnownAt: string) {
  const data = businessWealthFixture();
  return consolidateHouseholdWealth({
    selectedPersonEntityIds: ["person:alex", "person:sam"],
    validAt: "2026-09-30",
    asKnownAt,
    baseCurrency: "GBP",
    accounts: data.accounts,
    accountValues,
    financialEntities: data.financialEntities,
    accountOwnerships: data.accountOwnerships,
    shareOwnershipInterests: data.shareOwnershipInterests,
    companyEquityValuations: data.companyEquityValuations,
  });
}

describe("business wealth entity and ownership contracts", () => {
  it("migrates legacy personal and shared account ownership deterministically", () => {
    const migrated = AssetTrackerDataSchema.parse({
      household: {
        members: [
          { id: "alex", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      accounts: [
        {
          id: "personal-cash",
          name: "Personal cash",
          provider: "Example Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2024-01-01",
        },
        {
          id: "shared-cash",
          name: "Shared cash",
          provider: "Example Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2024-02-01",
        },
      ],
      snapshots: [
        { accountId: "personal-cash", date: "2024-03-01", balance: 1_000 },
        { accountId: "shared-cash", date: "2024-03-01", balance: 2_000 },
      ],
      ownership: {
        accounts: {
          "personal-cash": { kind: "personal", memberId: "alex" },
          "shared-cash": {
            kind: "shared",
            shares: [
              { memberId: "alex", share: 0.6 },
              { memberId: "sam", share: 0.4 },
            ],
          },
        },
      },
    });

    expect(migrated.household.id).toBe("household");
    expect(
      migrated.financialEntities.map(({ entityId }) => entityId).sort(),
    ).toEqual([legacyPersonEntityId("alex"), legacyPersonEntityId("sam")]);
    expect(migrated.accountOwnerships).toMatchObject([
      {
        recordId: "legacy-account-ownership:personal-cash",
        effectiveFrom: "2024-01-01",
        acceptedAt: "2026-11-06T00:00:00.000Z",
        lineage: {
          kind: "migration",
          sourceId: "assettracker:data:v1",
          sourceRevision: "legacy-household-ownership-v1",
        },
        ownership: {
          state: "known",
          allocations: [{ entityId: "person:alex", fraction: 1 }],
        },
      },
      {
        recordId: "legacy-account-ownership:shared-cash",
        effectiveFrom: "2024-02-01",
        ownership: {
          state: "known",
          allocations: [
            { entityId: "person:alex", fraction: 0.6 },
            { entityId: "person:sam", fraction: 0.4 },
          ],
        },
      },
    ]);
    expect(migrated.snapshots).toHaveLength(2);
    expect(() => buildRepository(migrated)).not.toThrow();
  });

  it("keeps company assets, liabilities, and tax obligations with the company", () => {
    const data = businessWealthFixture();
    const repository = buildRepository(data);

    expect(repository.accounts.get("company-loan")?.assetType).toBe("debt");
    expect(
      accountOwnershipAt(
        repository.accountOwnerships,
        "company-loan",
        "2026-09-30",
      )?.ownership,
    ).toEqual({
      state: "known",
      allocations: [{ entityId: "company:northstar", fraction: 1 }],
    });
    expect(repository.entityObligations).toMatchObject([
      {
        entityId: "company:northstar",
        kind: "corporation-tax",
        amount: { state: "known", amount: 20_000, currency: "GBP" },
      },
    ]);
  });

  it("selects dated ownership without granting the outside owner household access", () => {
    const data = businessWealthFixture();
    buildRepository(data);

    const before = shareOwnershipAt(
      data.shareOwnershipInterests,
      "company:northstar",
      "2026-06-30",
    );
    const after = shareOwnershipAt(
      data.shareOwnershipInterests,
      "company:northstar",
      "2026-07-01",
    );

    expect(
      Object.fromEntries(
        before.map(({ ownerEntityId, fraction }) => [ownerEntityId, fraction]),
      ),
    ).toEqual({
      "person:alex": { state: "known", fraction: 0.75 },
      "person:outside": { state: "known", fraction: 0.25 },
    });
    expect(
      Object.fromEntries(
        after.map(({ ownerEntityId, fraction }) => [ownerEntityId, fraction]),
      ),
    ).toEqual({
      "person:alex": { state: "known", fraction: 0.4 },
      "person:sam": { state: "known", fraction: 0.35 },
      "person:outside": { state: "known", fraction: 0.25 },
    });
    expect(data.household.members.map(({ id }) => id)).toEqual(["alex", "sam"]);
  });

  it("dates an account ownership change without rewriting the account", () => {
    const data = businessWealthFixture();
    const personal = data.accountOwnerships.find(
      ({ accountId }) => accountId === "shared-cash",
    );
    if (personal == null) throw new Error("fixture has no shared ownership");
    personal.effectiveTo = "2026-08-01";
    data.accountOwnerships.push({
      ...personal,
      recordId: "owner-shared-cash-company",
      effectiveFrom: "2026-08-01",
      effectiveTo: undefined,
      acceptedAt: "2026-08-01T00:00:00.000Z",
      ownership: {
        state: "known",
        allocations: [{ entityId: "company:northstar", fraction: 1 }],
      },
    });

    expect(() => buildRepository(data)).not.toThrow();
    expect(
      accountOwnershipAt(data.accountOwnerships, "shared-cash", "2026-07-31")
        ?.recordId,
    ).toBe("owner-shared-cash-v1");
    expect(
      accountOwnershipAt(data.accountOwnerships, "shared-cash", "2026-08-01")
        ?.recordId,
    ).toBe("owner-shared-cash-company");
    expect(data.accounts.filter(({ id }) => id === "shared-cash")).toHaveLength(
      1,
    );
  });

  it("retains both entity endpoints and cited ledger records for a transfer", () => {
    const repository = buildRepository(businessWealthFixture());
    const transfer = repository.entityTransfers[0];

    expect(transfer).toMatchObject({
      transferId: "transfer-dividend",
      classification: { state: "known", kind: "dividend" },
      legs: [
        {
          role: "source",
          endpoint: { kind: "entity", entityId: "company:northstar" },
          accountId: "company-cash",
          accountEntryId: "company-cash-entry-dividend",
        },
        {
          role: "destination",
          endpoint: { kind: "entity", entityId: "person:alex" },
          accountId: "alex-cash",
          accountEntryId: "alex-cash-entry-dividend",
        },
      ],
    });
  });

  it("uses one business-interest contribution and excludes underlying company accounts", () => {
    const original = consolidate("2026-10-15T00:00:00.000Z");
    const corrected = consolidate("2026-11-15T00:00:00.000Z");

    expect(original.knownSubtotal).toBe(180_000);
    expect(original.includedContributionIds).toEqual([
      "account:alex-cash",
      "account:shared-cash",
      "business-interest:company:northstar",
    ]);
    expect(original.excludedUnderlyingIds).toEqual([
      "company-cash",
      "company-loan",
    ]);
    expect(original.valuationRecordIds).toEqual([
      "northstar-valuation-original",
    ]);
    expect(original.contributions.at(-1)).toMatchObject({
      kind: "business-interest",
      amount: 150_000,
      attribution: [
        { personEntityId: "person:alex", amount: 80_000 },
        { personEntityId: "person:sam", amount: 70_000 },
      ],
    });
    expect(corrected.knownSubtotal).toBe(210_000);
    expect(corrected.valuationRecordIds).toEqual([
      "northstar-valuation-correction",
    ]);
  });

  it("keeps an unrecorded share unresolved instead of inventing a value", () => {
    const data = businessWealthFixture();
    const samInterest = data.shareOwnershipInterests.find(
      ({ recordId }) => recordId === "interest-sam-current",
    );
    if (samInterest == null) throw new Error("fixture has no Sam interest");
    samInterest.fraction = { state: "fraction-not-recorded" };

    const result = consolidateHouseholdWealth({
      selectedPersonEntityIds: ["person:alex", "person:sam"],
      validAt: "2026-09-30",
      asKnownAt: "2026-10-15T00:00:00.000Z",
      baseCurrency: "GBP",
      accounts: data.accounts,
      accountValues,
      financialEntities: data.financialEntities,
      accountOwnerships: data.accountOwnerships,
      shareOwnershipInterests: data.shareOwnershipInterests,
      companyEquityValuations: data.companyEquityValuations,
    });

    expect(result.knownSubtotal).toBe(30_000);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({
      kind: "share_fraction_not_recorded",
      subjectId: "company:northstar",
    });
  });

  it("counts a candidate-owned shared account once as unallocated value", () => {
    const data = businessWealthFixture();
    const sharedOwnership = data.accountOwnerships.find(
      ({ accountId }) => accountId === "shared-cash",
    );
    if (sharedOwnership == null)
      throw new Error("fixture has no shared account ownership");
    sharedOwnership.ownership = {
      state: "candidate-owners",
      candidateEntityIds: ["person:alex", "person:sam"],
    };

    const result = consolidateHouseholdWealth({
      selectedPersonEntityIds: ["person:alex", "person:sam"],
      validAt: "2026-09-30",
      asKnownAt: "2026-10-15T00:00:00.000Z",
      baseCurrency: "GBP",
      accounts: data.accounts,
      accountValues,
      financialEntities: data.financialEntities,
      accountOwnerships: data.accountOwnerships,
      shareOwnershipInterests: data.shareOwnershipInterests,
      companyEquityValuations: data.companyEquityValuations,
    });

    expect(result.knownSubtotal).toBe(180_000);
    expect(
      result.contributions.find(({ id }) => id === "account:shared-cash"),
    ).toMatchObject({ amount: 10_000, attribution: [] });
    expect(result.issues).toContainEqual({
      kind: "candidate_account_owners",
      subjectId: "shared-cash",
    });
  });

  it("reports a missing direct-account value without inventing zero", () => {
    const data = businessWealthFixture();
    const result = consolidateHouseholdWealth({
      selectedPersonEntityIds: ["person:alex", "person:sam"],
      validAt: "2026-09-30",
      asKnownAt: "2026-10-15T00:00:00.000Z",
      baseCurrency: "GBP",
      accounts: data.accounts,
      accountValues: accountValues.filter(
        ({ accountId }) => accountId !== "alex-cash",
      ),
      financialEntities: data.financialEntities,
      accountOwnerships: data.accountOwnerships,
      shareOwnershipInterests: data.shareOwnershipInterests,
      companyEquityValuations: data.companyEquityValuations,
    });

    expect(result.knownSubtotal).toBe(160_000);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({
      kind: "missing_account_value",
      subjectId: "alex-cash",
    });
  });

  it("reports an unsupported valuation while retaining known direct wealth", () => {
    const data = businessWealthFixture();
    const valuation = data.companyEquityValuations.find(
      ({ recordId }) => recordId === "northstar-valuation-original",
    );
    if (valuation == null) throw new Error("fixture has no company valuation");
    valuation.amount = {
      state: "unsupported",
      currency: "GBP",
      reason: "Going-concern method is not implemented",
    };

    const result = consolidateHouseholdWealth({
      selectedPersonEntityIds: ["person:alex", "person:sam"],
      validAt: "2026-09-30",
      asKnownAt: "2026-10-15T00:00:00.000Z",
      baseCurrency: "GBP",
      accounts: data.accounts,
      accountValues,
      financialEntities: data.financialEntities,
      accountOwnerships: data.accountOwnerships,
      shareOwnershipInterests: data.shareOwnershipInterests,
      companyEquityValuations: data.companyEquityValuations,
    });

    expect(result.knownSubtotal).toBe(30_000);
    expect(result.issues).toContainEqual({
      kind: "unsupported_company_valuation",
      subjectId: "company:northstar",
      reason: "Going-concern method is not implemented",
    });
  });

  it("reports a valuation amount that has not been recorded", () => {
    const data = businessWealthFixture();
    const valuation = data.companyEquityValuations.find(
      ({ recordId }) => recordId === "northstar-valuation-original",
    );
    if (valuation == null) throw new Error("fixture has no company valuation");
    valuation.amount = {
      state: "amount-not-recorded",
      currency: "GBP",
    };

    const result = consolidateHouseholdWealth({
      selectedPersonEntityIds: ["person:alex", "person:sam"],
      validAt: "2026-09-30",
      asKnownAt: "2026-10-15T00:00:00.000Z",
      baseCurrency: "GBP",
      accounts: data.accounts,
      accountValues,
      financialEntities: data.financialEntities,
      accountOwnerships: data.accountOwnerships,
      shareOwnershipInterests: data.shareOwnershipInterests,
      companyEquityValuations: data.companyEquityValuations,
    });

    expect(result.knownSubtotal).toBe(30_000);
    expect(result.issues).toContainEqual({
      kind: "company_valuation_not_recorded",
      subjectId: "company:northstar",
    });
  });

  it("rejects invalid totals, overlapping interests, and missing entities", () => {
    const invalidTotal = businessWealthFixture();
    const outsideInterest = invalidTotal.shareOwnershipInterests[2];
    if (outsideInterest == null)
      throw new Error("fixture has no outside owner");
    invalidTotal.shareOwnershipInterests.push({
      ...outsideInterest,
      recordId: "interest-extra",
      ownerEntityId: "person:outside",
      interestId: "northstar-preference",
      fraction: { state: "known", fraction: 0.1 },
    });
    expect(() => buildRepository(invalidTotal)).toThrow(/exceeds 100%/);

    const overlapping = businessWealthFixture();
    const currentAlexInterest = overlapping.shareOwnershipInterests[1];
    if (currentAlexInterest == null)
      throw new Error("fixture has no current Alex interest");
    overlapping.shareOwnershipInterests.push({
      ...currentAlexInterest,
      recordId: "interest-alex-overlap",
      effectiveFrom: "2026-08-01",
    });
    expect(() => buildRepository(overlapping)).toThrow(/overlap/);

    const missingEntity = businessWealthFixture();
    const firstOwnership = missingEntity.accountOwnerships[0];
    if (firstOwnership == null)
      throw new Error("fixture has no account ownership");
    firstOwnership.ownership = {
      state: "known",
      allocations: [{ entityId: "person:missing", fraction: 1 }],
    };
    expect(() => buildRepository(missingEntity)).toThrow(
      /missing entity "person:missing"/,
    );

    const emptyCandidates = businessWealthFixture();
    const sharedOwnership = emptyCandidates.accountOwnerships.find(
      ({ accountId }) => accountId === "shared-cash",
    );
    if (sharedOwnership == null)
      throw new Error("fixture has no shared account ownership");
    sharedOwnership.ownership = {
      state: "candidate-owners",
      candidateEntityIds: [],
    };
    expect(() => buildRepository(emptyCandidates)).toThrow();

    const duplicatedLiability = businessWealthFixture();
    const obligation = duplicatedLiability.entityObligations[0];
    if (obligation == null) throw new Error("fixture has no tax obligation");
    obligation.obligationId = "northstar-working-capital-debt";
    expect(() => buildRepository(duplicatedLiability)).toThrow(
      /cannot be both an account and an obligation/,
    );
  });

  it("round-trips all business records through a household backup", () => {
    const data = businessWealthFixture();
    const backup = createAssetTrackerBackup(data, "2026-11-06T12:00:00.000Z");
    const restored = parseAssetTrackerBackup(
      JSON.parse(JSON.stringify(backup)) as unknown,
    );

    expect(restored.data.financialEntities).toEqual(data.financialEntities);
    expect(restored.data.accountOwnerships).toEqual(data.accountOwnerships);
    expect(restored.data.shareOwnershipInterests).toEqual(
      data.shareOwnershipInterests,
    );
    expect(restored.data.entityObligations).toEqual(data.entityObligations);
    expect(restored.data.entityTransfers).toEqual(data.entityTransfers);
    expect(restored.data.companyEquityValuations).toEqual(
      data.companyEquityValuations,
    );
  });

  it("migrates a version-one backup whose summary predates business records", () => {
    const preview = previewAssetTrackerBackup(businessWealthFixture(), {
      format: ASSET_TRACKER_BACKUP_FORMAT,
      schemaVersion: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      summary: {
        householdMembers: 1,
        accounts: 1,
        balanceObservations: 1,
        storedRecords: 2,
        latestAccountBalances: [{ currency: "GBP", amount: 1_000 }],
      },
      data: {
        accounts: [
          {
            id: "legacy-cash",
            name: "Legacy cash",
            provider: "Example Bank",
            currency: "GBP",
            assetType: "cash",
            expectedAnnualReturn: 0,
            createdAt: "2025-01-01",
          },
        ],
        snapshots: [
          {
            accountId: "legacy-cash",
            date: "2026-09-30",
            balance: 1_000,
          },
        ],
      },
    });

    expect(preview.sourceVersion).toBe(1);
    expect(preview.migrated).toBe(true);
    expect(preview.backup.data.financialEntities).toHaveLength(1);
    expect(preview.backup.data.accountOwnerships).toMatchObject([
      {
        accountId: "legacy-cash",
        ownership: {
          state: "known",
          allocations: [{ entityId: "person:primary", fraction: 1 }],
        },
      },
    ]);
  });
});
