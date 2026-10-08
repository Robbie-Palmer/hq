import { describe, expect, it } from "vitest";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import {
  AssetTrackerDataSchema,
  buildHouseholdTaxRequest,
  getHouseholdTaxEstimate,
} from "@/lib/domain/assettracker";

describe("household tax position", () => {
  it("builds an explainable estimate from browser-local demo records", () => {
    const data = getDemoAssetTrackerData();
    const result = getHouseholdTaxEstimate(data);

    expect(result.available).toBe(true);
    expect(result.totalTaxPence).toBe(2_120_621);
    expect(result.people).toHaveLength(2);
    expect(result.lineage.ruleDatasetVersion).toBe("2026.10.3");
    expect(result.lineage.observedRecordIds).toContain(
      "alex-payroll-to-date-2026-10-04",
    );
    expect(result.lineage.assumptionRecordIds).toContain(
      "alex-pay-forecast-2026-27",
    );
    expect(result.lineage.observedRecordIds).toContain(
      "marcus-interest-certificate-2026-27",
    );
    expect(result.lineage.assumptionRecordIds).toContain(
      "tax-profile-alex-2026-27",
    );
    expect(
      result.people.find(({ memberId }) => memberId === "sam")
        ?.excludedWrapperRecordIds,
    ).toContain("sam-isa-dividend-2026-27");
    expect(
      result.people.find(({ memberId }) => memberId === "sam")?.savingsTax
        .amountPence,
    ).toBe(10_000);
    expect(
      result.people.find(({ memberId }) => memberId === "sam")?.allowances
        .personalSavingsAllowancePence,
    ).toBe(100_000);
    const alex = result.people.find(({ memberId }) => memberId === "alex");
    expect(alex?.bandConsumption.observed.taxableIncomePence).toBe(3_863_000);
    expect(alex?.bandConsumption.projected.taxableIncomePence).toBe(4_863_000);
    expect(alex?.bandConsumption.projected.bands[1]?.dividendsPence).toBe(
      93_000,
    );
    expect(alex?.allowances.pensionObservedContributionsPence).toBe(800_000);
    expect(alex?.allowances.pensionContributionsPence).toBe(1_000_000);
    const sam = result.people.find(({ memberId }) => memberId === "sam");
    expect(sam?.allowances.isaObservedContributionsPence).toBe(400_000);
    expect(sam?.allowances.isaContributionsPence).toBe(600_000);
  });

  it("uses a standard profile for older browser data", () => {
    const data = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const result = getHouseholdTaxEstimate(data);

    expect(data.taxPosition).toBeUndefined();
    expect(result.available).toBe(true);
    expect(result.totalTaxPence).toBe(0);
    expect(result.lineage.assumptionRecordIds).toContain(
      "default-tax-profile-primary-2026-27",
    );
  });

  it("infers projected employment income from recurring gross pay", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "current",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2020-01-01",
        },
      ],
      snapshots: [],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "current",
          amount: 5_500,
          grossAmount: 10_000,
          compensationKind: "takeHomeIncome",
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-01-01",
        },
      ],
    });

    const request = buildHouseholdTaxRequest(data, "2026-10-08");

    expect(
      request.incomes.reduce((total, income) => total + income.amountPence, 0),
    ).toBe(12_000_000);
    expect(request.incomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "primary",
          kind: "employment",
          evidence: expect.objectContaining({ timing: "to-date" }),
        }),
        expect.objectContaining({
          memberId: "primary",
          kind: "employment",
          evidence: expect.objectContaining({ timing: "year-end" }),
        }),
      ]),
    );
    expect(request.people[0]).toMatchObject({
      memberId: "primary",
      nationalInsuranceCategory: "A",
    });
    expect(getHouseholdTaxEstimate(data, "2026-10-08").available).toBe(true);
  });

  it("models salary sacrifice and pension allowance usage from recurring flows", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "current",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2020-01-01",
        },
        {
          id: "pension",
          name: "Pension",
          provider: "Pension provider",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.05,
          createdAt: "2020-01-01",
        },
      ],
      snapshots: [],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "current",
          amount: 5_495,
          grossAmount: 10_000,
          compensationKind: "takeHomeIncome",
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-03-27",
        },
        {
          id: "employee-pension",
          name: "Employee pension",
          toAccountId: "pension",
          amount: 2_000,
          compensationKind: "employeePension",
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-03-27",
        },
        {
          id: "employer-pension",
          name: "Employer pension",
          toAccountId: "pension",
          amount: 500,
          compensationKind: "employerPension",
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-03-27",
        },
      ],
    });

    const request = buildHouseholdTaxRequest(data, "2026-10-08");
    const result = getHouseholdTaxEstimate(data, "2026-10-08");
    const person = result.people[0];

    expect(request.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pension", wrapper: "pension" }),
      ]),
    );
    expect(
      request.incomes.reduce((total, income) => total + income.amountPence, 0),
    ).toBe(9_600_000);
    expect(
      request.incomes.find(({ evidence }) => evidence.timing === "to-date")
        ?.amountPence,
    ).toBe(4_800_000);
    expect(
      request.contributions.reduce(
        (total, contribution) => total + contribution.amountPence,
        0,
      ),
    ).toBe(3_000_000);
    expect(
      request.contributions
        .filter(({ evidence }) => evidence.timing === "to-date")
        .reduce((total, contribution) => total + contribution.amountPence, 0),
    ).toBe(1_500_000);
    expect(result.available).toBe(true);
    expect(
      (person?.bandConsumption.observed.personalAllowanceByIncome
        .employmentPence ?? 0) +
        (person?.bandConsumption.observed.bands.reduce(
          (total, band) => total + band.employmentPence,
          0,
        ) ?? 0),
    ).toBe(4_800_000);
    expect(person?.allowances.pensionObservedContributionsPence).toBe(
      1_500_000,
    );
    expect(person?.allowances.pensionContributionsPence).toBe(3_000_000);
  });

  it("counts transfers into an ISA as subscriptions", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "current",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2020-01-01",
        },
        {
          id: "isa",
          name: "Stocks ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          taxWrapper: "isa",
          expectedAnnualReturn: 0.05,
          createdAt: "2020-01-01",
        },
        {
          id: "old-isa",
          name: "Old ISA",
          provider: "Old broker",
          currency: "GBP",
          assetType: "stocks",
          taxWrapper: "isa",
          expectedAnnualReturn: 0.05,
          createdAt: "2020-01-01",
        },
      ],
      snapshots: [],
      transfers: [
        {
          id: "cash-to-isa",
          date: "2026-05-01",
          fromAccountId: "current",
          toAccountId: "isa",
          amount: 5_000,
        },
        {
          id: "external-to-isa",
          date: "2026-06-01",
          toAccountId: "isa",
          amount: 1_000,
        },
        {
          id: "isa-provider-transfer",
          date: "2026-07-01",
          fromAccountId: "old-isa",
          toAccountId: "isa",
          amount: 2_000,
        },
      ],
    });

    const result = getHouseholdTaxEstimate(data, "2026-10-08");
    const person = result.people[0];

    expect(person?.allowances.isaObservedContributionsPence).toBe(600_000);
    expect(person?.allowances.isaContributionsPence).toBe(600_000);
    expect(result.lineage.observedRecordIds).toEqual(
      expect.arrayContaining(["cash-to-isa", "external-to-isa"]),
    );
    expect(result.lineage.observedRecordIds).not.toContain(
      "isa-provider-transfer",
    );
  });

  it("flags a referenced account without a tax wrapper", () => {
    const data = getDemoAssetTrackerData();
    if (data.taxPosition == null) throw new Error("Expected demo tax records");
    const disposal = data.taxPosition.disposals[0];
    if (disposal == null) throw new Error("Expected demo disposal");
    data.taxPosition.disposals[0] = {
      ...disposal,
      accountId: "home",
    };

    expect(buildHouseholdTaxRequest(data).unsupportedCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-account-wrapper" }),
      ]),
    );
  });
});
