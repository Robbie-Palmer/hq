import { describe, expect, it } from "vitest";
import {
  calculatePensionAnnualAllowance,
  calculatePensionAnnualAllowanceIncome,
  type CarryForwardYear,
  type PensionAnnualAllowanceIncome,
  type PensionAnnualAllowanceRequest,
  type PensionInput,
} from "../src/annualAllowance";
import { pensionAnnualAllowanceFixtures } from "../src/annualAllowanceFixtures";

const zeroIncome = (): PensionAnnualAllowanceIncome => ({
  netIncomePence: 0,
  post8July2015SalarySacrificePence: 0,
  post8July2015FlexibleRemunerationPence: 0,
  reliefAtSourceNetContributionsPence: 0,
  claimedPensionReliefPence: 0,
  netPayContributionsPence: 0,
  otherMemberContributionsPence: 0,
  taxableLumpSumDeathBenefitsPence: 0,
});

const priorYears = (taxYear: string): CarryForwardYear[] => {
  const start = Number(taxYear.slice(0, 4));
  return [start - 3, start - 2, start - 1].map((year) => ({
    taxYear: `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
    registeredSchemeMember: false,
    annualAllowancePence: null,
    pensionInputPence: null,
  }));
};

function request(
  overrides: Partial<PensionAnnualAllowanceRequest> = {},
): PensionAnnualAllowanceRequest {
  return {
    taxYear: "2025-26",
    jurisdiction: "england-and-northern-ireland",
    income: zeroIncome(),
    pensionInputs: [],
    priorYears: priorYears("2025-26"),
    flexibleAccessDate: null,
    charge: { reducedNetIncomePence: null, rateBands: null },
    schemePays: { status: "none" },
    ...overrides,
  };
}

describe("pension annual allowance", () => {
  it("reproduces HMRC's full threshold-income and adjusted-income example", () => {
    const fixture = pensionAnnualAllowanceFixtures.jonTaper;
    const result = calculatePensionAnnualAllowanceIncome(
      fixture.taxYear,
      fixture.income,
      fixture.pensionInputs,
    );

    expect(result.available).toBe(true);
    expect(result).toMatchObject(fixture.expected);
  });

  it("applies every statutory add-back, deduction, and employer-input step", () => {
    const income = {
      ...zeroIncome(),
      netIncomePence: 10_000_000,
      post8July2015SalarySacrificePence: 2_000_000,
      post8July2015FlexibleRemunerationPence: 1_000_000,
      reliefAtSourceNetContributionsPence: 800_000,
      claimedPensionReliefPence: 300_000,
      netPayContributionsPence: 500_000,
      otherMemberContributionsPence: 200_000,
      taxableLumpSumDeathBenefitsPence: 500_000,
    };
    const inputs: PensionInput[] = [
      {
        id: "dc",
        schemeId: "dc",
        arrangement: "money-purchase",
        inputPence: 1_500_000,
      },
      {
        id: "db",
        schemeId: "db",
        arrangement: "defined-benefit",
        inputPence: 1_500_000,
      },
    ];
    const result = calculatePensionAnnualAllowanceIncome(
      "2023-24",
      income,
      inputs,
    );

    expect(result).toMatchObject({
      available: true,
      reliefAtSourceGrossContributionsPence: 1_000_000,
      totalMemberContributionsPence: 1_700_000,
      thresholdIncomePence: 11_500_000,
      adjustedIncomePence: 11_600_000,
    });
  });

  it("returns unavailable instead of guessing a missing statutory amount", () => {
    const result = calculatePensionAnnualAllowanceIncome(
      "2025-26",
      { ...zeroIncome(), post8July2015SalarySacrificePence: null },
      [],
    );

    expect(result).toEqual({
      available: false,
      issues: [
        expect.objectContaining({ code: "missing-statutory-input" }),
      ],
    });
  });

  it.each([
    ["2019-20", 11_100_000, 4_000_000, 3_950_000],
    ["2022-23", 20_100_000, 4_000_000, 3_950_000],
    ["2023-24", 20_100_000, 6_000_000, 5_950_000],
  ])(
    "uses the historical taper regime for %s",
    (taxYear, netIncomePence, inputPence, expectedAllowancePence) => {
      const result = calculatePensionAnnualAllowanceIncome(
        taxYear,
        { ...zeroIncome(), netIncomePence },
        [
          {
            id: "employer-input",
            schemeId: "scheme",
            arrangement: "defined-benefit",
            inputPence,
          },
        ],
      );

      expect(result).toMatchObject({
        available: true,
        taperApplied: true,
        taperedAnnualAllowancePence: expectedAllowancePence,
      });
    },
  );

  it.each([
    ["2019-20", 11_100_000, 10_500_000, 1_000_000],
    ["2022-23", 20_100_000, 11_900_000, 400_000],
    ["2023-24", 20_100_000, 15_900_000, 1_000_000],
  ])(
    "does not taper below the historical minimum for %s",
    (taxYear, netIncomePence, inputPence, minimumAllowancePence) => {
      const result = calculatePensionAnnualAllowanceIncome(
        taxYear,
        { ...zeroIncome(), netIncomePence },
        [
          {
            id: "employer-input",
            schemeId: "scheme",
            arrangement: "defined-benefit",
            inputPence,
          },
        ],
      );

      expect(result).toMatchObject({
        available: true,
        taperedAnnualAllowancePence: minimumAllowancePence,
      });
    },
  );

  it.each([
    ["2016-17", "2015-01-01", 1_000_000],
    ["2019-20", "2018-01-01", 400_000],
    ["2023-24", "2022-01-01", 1_000_000],
  ])(
    "uses the historical money purchase allowance for %s",
    (taxYear, flexibleAccessDate, allowancePence) => {
      const result = calculatePensionAnnualAllowance(
        request({
          taxYear,
          priorYears: priorYears(taxYear),
          flexibleAccessDate,
          pensionInputs: [
            {
              id: "dc-input",
              schemeId: "dc",
              arrangement: "money-purchase",
              inputPence: allowancePence + 100_000,
            },
          ],
          charge: {
            reducedNetIncomePence: 0,
            rateBands: [{ upperLimitPence: null, rateBasisPoints: 2_000 }],
          },
        }),
      );

      expect(result).toMatchObject({
        available: true,
        moneyPurchase: {
          applies: true,
          allowancePence,
          excessPence: 100_000,
        },
      });
    },
  );

  it("does not taper at either exact statutory threshold", () => {
    const thresholdBoundary = calculatePensionAnnualAllowanceIncome(
      "2023-24",
      { ...zeroIncome(), netIncomePence: 20_000_000 },
      [
        {
          id: "input",
          schemeId: "scheme",
          arrangement: "defined-benefit",
          inputPence: 6_100_000,
        },
      ],
    );
    const adjustedBoundary = calculatePensionAnnualAllowanceIncome(
      "2023-24",
      { ...zeroIncome(), netIncomePence: 20_100_000 },
      [
        {
          id: "input",
          schemeId: "scheme",
          arrangement: "defined-benefit",
          inputPence: 5_900_000,
        },
      ],
    );

    expect(thresholdBoundary).toMatchObject({
      available: true,
      taperApplied: false,
    });
    expect(adjustedBoundary).toMatchObject({
      available: true,
      taperApplied: false,
    });
  });

  it("rounds a half-pound taper reduction down to the preceding pound", () => {
    const result = calculatePensionAnnualAllowanceIncome(
      "2019-20",
      { ...zeroIncome(), netIncomePence: 11_100_000 },
      [
        {
          id: "input",
          schemeId: "scheme",
          arrangement: "defined-benefit",
          inputPence: 6_697_900,
        },
      ],
    );

    expect(result).toMatchObject({
      available: true,
      adjustedIncomePence: 17_797_900,
      taperReductionPence: 1_398_900,
      taperedAnnualAllowancePence: 2_601_100,
    });
  });

  it("uses current allowance first and carry forward earliest year first", () => {
    const result = calculatePensionAnnualAllowance(
      request({
        pensionInputs: [
          {
            id: "db-input",
            schemeId: "db",
            arrangement: "defined-benefit",
            inputPence: 9_000_000,
          },
        ],
        priorYears: [
          {
            taxYear: "2022-23",
            registeredSchemeMember: true,
            annualAllowancePence: 4_000_000,
            pensionInputPence: 3_000_000,
          },
          {
            taxYear: "2023-24",
            registeredSchemeMember: true,
            annualAllowancePence: 6_000_000,
            pensionInputPence: 5_000_000,
          },
          {
            taxYear: "2024-25",
            registeredSchemeMember: false,
            annualAllowancePence: null,
            pensionInputPence: null,
          },
        ],
        charge: {
          reducedNetIncomePence: 0,
          rateBands: [{ upperLimitPence: null, rateBasisPoints: 2_000 }],
        },
      }),
    );

    expect(result).toMatchObject({
      available: true,
      carryForward: {
        availablePence: 2_000_000,
        usedPence: 2_000_000,
        years: [
          { taxYear: "2022-23", usedPence: 1_000_000 },
          { taxYear: "2023-24", usedPence: 1_000_000 },
          { taxYear: "2024-25", usedPence: 0 },
        ],
      },
      tests: { chargeablePence: 1_000_000 },
      annualAllowanceCharge: { amountPence: 200_000 },
    });
  });

  it("requires all three years of membership and usage facts", () => {
    const result = calculatePensionAnnualAllowance(
      request({ priorYears: null }),
    );

    expect(result).toEqual({
      available: false,
      issues: [
        expect.objectContaining({ code: "invalid-carry-forward-history" }),
      ],
    });
  });

  it("reproduces HMRC's MPAA and alternative-allowance example", () => {
    const fixture = pensionAnnualAllowanceFixtures.dwayneMpaa;
    const result = calculatePensionAnnualAllowance(fixture.request);

    expect(result).toMatchObject({
      available: true,
      moneyPurchase: {
        applies: true,
        testedInputPence: fixture.expected.testedInputPence,
        otherInputPence: fixture.expected.otherInputPence,
        alternativeAnnualAllowancePence:
          fixture.expected.alternativeAnnualAllowancePence,
      },
      tests: {
        selected: "alternative",
        defaultChargeablePence: fixture.expected.defaultChargeablePence,
        alternativeChargeablePence:
          fixture.expected.alternativeChargeablePence,
      },
    });
  });

  it("requires post-trigger money-purchase input in the trigger year", () => {
    const result = calculatePensionAnnualAllowance(
      request({
        flexibleAccessDate: "2025-10-01",
        pensionInputs: [
          {
            id: "dc-input",
            schemeId: "dc",
            arrangement: "money-purchase",
            inputPence: 2_000_000,
          },
        ],
      }),
    );

    expect(result).toEqual({
      available: false,
      issues: [expect.objectContaining({ code: "missing-post-trigger-input" })],
    });
  });

  it("reproduces HMRC's annual charge and mandatory Scheme Pays example", () => {
    const fixture = pensionAnnualAllowanceFixtures.traceySchemePays;
    const result = calculatePensionAnnualAllowance(fixture.request);

    expect(result).toMatchObject({
      available: true,
      tests: { chargeablePence: fixture.expected.chargeablePence },
      annualAllowanceCharge: {
        amountPence: fixture.expected.annualAllowanceChargePence,
        slices: [
          { amountPence: 2_000_000, rateBasisPoints: 4_000 },
          { amountPence: 500_000, rateBasisPoints: 4_500 },
        ],
      },
      schemePays: {
        electionEvidence: "observed",
        basis: "mandatory",
        mandatoryEligibleSchemeIds:
          fixture.expected.mandatoryEligibleSchemeIds,
        mandatoryMaximumPenceByScheme: {
          "scheme-1": fixture.expected.mandatoryMaximumPence,
        },
        memberRemainsLiablePence:
          fixture.expected.memberRemainsLiablePence,
      },
    });
  });

  it("keeps an assumed voluntary Scheme Pays payment distinct from an election", () => {
    const fixture = pensionAnnualAllowanceFixtures.traceySchemePays;
    const result = calculatePensionAnnualAllowance({
      ...fixture.request,
      schemePays: {
        status: "assumed",
        schemeId: "scheme-2",
        amountPence: 100_000,
      },
    });

    expect(result).toMatchObject({
      available: true,
      schemePays: {
        electionEvidence: "assumption",
        basis: "voluntary",
        schemeId: "scheme-2",
      },
    });
  });

  it("does not guess the charge when reduced net income is absent", () => {
    const result = calculatePensionAnnualAllowance(
      request({
        pensionInputs: [
          {
            id: "db-input",
            schemeId: "db",
            arrangement: "defined-benefit",
            inputPence: 7_000_000,
          },
        ],
      }),
    );

    expect(result).toEqual({
      available: false,
      issues: [expect.objectContaining({ code: "missing-charge-input" })],
    });
  });
});
