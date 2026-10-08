import { describe, expect, it } from "vitest";
import {
  calculateHouseholdTaxPosition,
  type HouseholdTaxRequest,
} from "../src/householdTax";

const observed = (sourceRecordId: string) => ({
  kind: "observed" as const,
  sourceRecordId,
  detail: "Imported statement record",
});

const forecast = (sourceRecordId: string) => ({
  kind: "assumption" as const,
  sourceRecordId,
  detail: "User-entered year-end forecast",
});

function request(
  overrides: Partial<HouseholdTaxRequest> = {},
): HouseholdTaxRequest {
  return {
    taxYear: "2026-27",
    people: [
      {
        memberId: "alex",
        displayName: "Alex",
        jurisdiction: "england-and-northern-ireland",
        residence: "full-year-uk",
        hasTaxableBenefits: false,
        nationalInsuranceCategory: "A",
        isCompanyDirector: false,
        flexiblyAccessedPension: false,
        evidence: {
          kind: "assumption",
          sourceRecordId: "tax-profile-alex",
          detail: "Confirmed by the user",
        },
      },
    ],
    accounts: [
      {
        id: "general",
        memberId: "alex",
        name: "General account",
        wrapper: "taxable",
        holdingRecordIds: ["holding-general"],
      },
      {
        id: "isa",
        memberId: "alex",
        name: "ISA",
        wrapper: "isa",
        holdingRecordIds: ["holding-isa"],
      },
      {
        id: "pension",
        memberId: "alex",
        name: "Pension",
        wrapper: "pension",
        holdingRecordIds: [],
      },
    ],
    incomes: [
      {
        id: "salary",
        memberId: "alex",
        employmentId: "job",
        kind: "employment",
        amountPence: 2_957_000,
        evidence: observed("salary-import-row-1"),
      },
      {
        id: "dividend",
        memberId: "alex",
        accountId: "general",
        kind: "dividend",
        amountPence: 300_000,
        evidence: observed("broker-row-1"),
      },
    ],
    disposals: [],
    contributions: [],
    unsupportedCases: [],
    ...overrides,
  };
}

describe("household UK tax position", () => {
  it("matches HMRC's 2026/27 dividend example", () => {
    const result = calculateHouseholdTaxPosition(request());

    expect(result.available).toBe(true);
    expect(result.people[0]?.incomeTax.amountPence).toBe(340_000);
    expect(result.people[0]?.dividendTax.amountPence).toBe(26_875);
    expect(result.people[0]?.allowances.dividendAllowancePence).toBe(50_000);
  });

  it("switches dividend rates at the tax-year boundary", () => {
    const oldYear = calculateHouseholdTaxPosition(
      request({ taxYear: "2025-26" }),
    );
    const newYear = calculateHouseholdTaxPosition(request());

    expect(oldYear.people[0]?.dividendTax.amountPence).toBe(21_875);
    expect(newYear.people[0]?.dividendTax.amountPence).toBe(26_875);
  });

  it.each([
    {
      name: "basic-rate taxpayer",
      employmentPence: 4_000_000,
      interestPence: 150_000,
      allowancePence: 100_000,
      expectedTaxPence: 10_000,
    },
    {
      name: "higher-rate taxpayer",
      employmentPence: 6_000_000,
      interestPence: 150_000,
      allowancePence: 50_000,
      expectedTaxPence: 40_000,
    },
    {
      name: "additional-rate taxpayer",
      employmentPence: 13_000_000,
      interestPence: 100_000,
      allowancePence: 0,
      expectedTaxPence: 45_000,
    },
  ])(
    "applies the Personal Savings Allowance for a $name",
    ({ allowancePence, employmentPence, expectedTaxPence, interestPence }) => {
      const result = calculateHouseholdTaxPosition(
        request({
          incomes: [
            {
              id: "salary",
              memberId: "alex",
              employmentId: "job",
              kind: "employment",
              amountPence: employmentPence,
              evidence: observed("salary"),
            },
            {
              id: "interest",
              memberId: "alex",
              accountId: "general",
              kind: "savings-interest",
              amountPence: interestPence,
              evidence: observed("interest"),
            },
          ],
        }),
      );

      expect(result.people[0]?.savingsTax.amountPence).toBe(expectedTaxPence);
      expect(
        result.people[0]?.allowances.personalSavingsAllowancePence,
      ).toBe(allowancePence);
    },
  );

  it("applies unused Personal Allowance before the starting rate for savings", () => {
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [
          {
            id: "salary",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 1_600_000,
            evidence: observed("salary"),
          },
          {
            id: "interest",
            memberId: "alex",
            accountId: "general",
            kind: "savings-interest",
            amountPence: 200_000,
            evidence: observed("interest"),
          },
        ],
      }),
    );

    expect(result.people[0]?.savingsTax.amountPence).toBe(0);
    expect(result.people[0]?.allowances.startingRateForSavingsPence).toBe(
      157_000,
    );
  });

  it("applies corrections and excludes ISA records", () => {
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [
          ...request().incomes,
          {
            id: "dividend-correction",
            correctsId: "dividend",
            memberId: "alex",
            accountId: "general",
            kind: "dividend",
            amountPence: 200_000,
            evidence: observed("broker-correction-row-2"),
          },
          {
            id: "isa-interest",
            memberId: "alex",
            accountId: "isa",
            kind: "savings-interest",
            amountPence: 400_000,
            evidence: observed("isa-interest-row-1"),
          },
          {
            id: "isa-dividend",
            memberId: "alex",
            accountId: "isa",
            kind: "dividend",
            amountPence: 900_000,
            evidence: observed("isa-row-1"),
          },
        ],
      }),
    );

    expect(result.people[0]?.dividendTax.amountPence).toBe(16_125);
    expect(result.people[0]?.excludedWrapperRecordIds).toEqual([
      "isa-interest",
      "isa-dividend",
    ]);
    expect(result.lineage.holdingRecordIds).toEqual([
      "holding-general",
      "holding-isa",
    ]);
  });

  it("uses the CGT exemption and remaining basic-rate band", () => {
    const employment = request().incomes[0];
    if (employment == null) throw new Error("Expected employment record");
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [employment],
        disposals: [
          {
            id: "fund-sale",
            memberId: "alex",
            accountId: "general",
            proceedsPence: 4_000_000,
            allowableCostPence: 1_000_000,
            lossesAppliedPence: 0,
            claimsRelief: false,
            evidence: observed("contract-note-1"),
          },
        ],
      }),
    );

    expect(result.people[0]?.capitalGainsTax.amountPence).toBe(523_800);
  });

  it("compares observed and projected tax-band consumption", () => {
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [
          {
            id: "salary-to-date",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 5_000_000,
            evidence: observed("payroll-to-date"),
          },
          {
            id: "salary-forecast",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 1_000_000,
            evidence: forecast("salary-forecast"),
          },
        ],
      }),
    );
    const consumption = result.people[0]?.bandConsumption;

    expect(consumption?.observed.personalAllowancePence).toBe(1_257_000);
    expect(consumption?.observed.bands[0]?.usedPence).toBe(3_743_000);
    expect(consumption?.observed.bands[1]?.usedPence).toBe(0);
    expect(consumption?.projected.bands[0]?.usedPence).toBe(3_770_000);
    expect(consumption?.projected.bands[1]?.employmentPence).toBe(973_000);
    expect(result.lineage.assumptionRecordIds).toContain("salary-forecast");
  });

  it("includes to-date estimates without relabelling them as observed", () => {
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [
          {
            id: "estimated-salary-to-date",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 4_800_000,
            evidence: {
              ...forecast("estimated-payroll-to-date"),
              timing: "to-date",
            },
          },
          {
            id: "salary-forecast",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 4_800_000,
            evidence: {
              ...forecast("salary-forecast"),
              timing: "year-end",
            },
          },
        ],
        contributions: [
          {
            id: "estimated-pension-to-date",
            memberId: "alex",
            accountId: "pension",
            kind: "pension",
            amountPence: 1_500_000,
            pensionMethod: "salary-sacrifice",
            employerContribution: true,
            evidence: {
              ...forecast("estimated-pension-to-date"),
              timing: "to-date",
            },
          },
          {
            id: "pension-forecast",
            memberId: "alex",
            accountId: "pension",
            kind: "pension",
            amountPence: 1_500_000,
            pensionMethod: "salary-sacrifice",
            employerContribution: true,
            evidence: {
              ...forecast("pension-forecast"),
              timing: "year-end",
            },
          },
        ],
      }),
    );
    const person = result.people[0];

    expect(
      (person?.bandConsumption.observed.personalAllowanceByIncome
        .employmentPence ?? 0) +
        (person?.bandConsumption.observed.bands.reduce(
          (total, band) => total + band.employmentPence,
          0,
        ) ?? 0),
    ).toBe(4_800_000);
    expect(
      (person?.bandConsumption.projected.personalAllowanceByIncome
        .employmentPence ?? 0) +
        (person?.bandConsumption.projected.bands.reduce(
          (total, band) => total + band.employmentPence,
          0,
        ) ?? 0),
    ).toBe(9_600_000);
    expect(person?.allowances.pensionObservedContributionsPence).toBe(
      1_500_000,
    );
    expect(person?.allowances.pensionContributionsPence).toBe(3_000_000);
    expect(result.lineage.observedRecordIds).not.toContain(
      "estimated-payroll-to-date",
    );
    expect(result.lineage.assumptionRecordIds).toContain(
      "estimated-payroll-to-date",
    );
  });

  it("exposes the Personal Allowance taper as an effective tax band", () => {
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [
          {
            id: "salary",
            memberId: "alex",
            employmentId: "job",
            kind: "employment",
            amountPence: 11_000_000,
            evidence: forecast("salary"),
          },
        ],
      }),
    );
    const taper = result.people[0]?.bandConsumption.projected.allowanceTaper;

    expect(taper).toEqual({
      adjustedNetIncomePence: 11_000_000,
      standardPersonalAllowancePence: 1_257_000,
      startsAtPence: 10_000_000,
      endsAtPence: 12_514_000,
      usedPence: 1_000_000,
      effectiveMarginalRateBasisPoints: 6_000,
    });
    expect(
      result.people[0]?.bandConsumption.projected.personalAllowancePence,
    ).toBe(757_000);
  });

  it("shows how much of the Personal Allowance income consumes", () => {
    const salary = request().incomes[0];
    if (salary == null) throw new Error("Expected salary record");
    const result = calculateHouseholdTaxPosition(
      request({
        incomes: [{ ...salary, amountPence: 1_000_000 }],
      }),
    );
    const observed = result.people[0]?.bandConsumption.observed;

    expect(observed?.personalAllowancePence).toBe(1_257_000);
    expect(observed?.personalAllowanceUsedPence).toBe(1_000_000);
    expect(observed?.personalAllowanceByIncome.employmentPence).toBe(1_000_000);
    expect(observed?.bands[0]?.usedPence).toBe(0);
  });

  it("withholds every total when an unsupported case is present", () => {
    const partialYear = request();
    const person = partialYear.people[0];
    if (person == null) throw new Error("Expected household member");
    partialYear.people[0] = {
      ...person,
      residence: "partial-year",
    };
    const result = calculateHouseholdTaxPosition(partialYear);

    expect(result.available).toBe(false);
    expect(result.totalTaxPence).toBeNull();
    expect(result.people[0]?.totalTaxPence).toBeNull();
    expect(result.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-residence" }),
      ]),
    );
  });
});
