import { describe, expect, it } from "vitest";
import {
  calculateMarriageAllowance,
  marriageAllowanceRuleSet,
  type MarriageAllowanceRequest,
} from "../src/marriageAllowance";
import {
  marriageAllowanceFixtureRequest,
  marriageAllowanceFixtures,
} from "../src/marriageAllowanceFixtures";

const request = (
  overrides: Partial<MarriageAllowanceRequest> = {},
): MarriageAllowanceRequest =>
  marriageAllowanceFixtureRequest(overrides);

describe("Marriage Allowance", () => {
  it("pins fixtures to the rule and enacted dataset versions", () => {
    expect(marriageAllowanceFixtures).toMatchObject({
      ruleSetVersion: marriageAllowanceRuleSet.ruleSetVersion,
      ruleDatasetVersion: marriageAllowanceRuleSet.ruleDatasetVersion,
    });
  });

  it("versions the transferable amount across every enacted tax year", () => {
    expect(
      marriageAllowanceRuleSet.rules.map((rule) => [
        rule.taxYear,
        rule.transferableAllowancePence,
        rule.maximumRecipientReductionPence,
      ]),
    ).toEqual([
      ["2015-16", 106_000, 21_200],
      ["2016-17", 110_000, 22_000],
      ["2017-18", 115_000, 23_000],
      ["2018-19", 119_000, 23_800],
      ["2019-20", 125_000, 25_000],
      ["2020-21", 125_000, 25_000],
      ["2021-22", 126_000, 25_200],
      ["2022-23", 126_000, 25_200],
      ["2023-24", 126_000, 25_200],
      ["2024-25", 126_000, 25_200],
      ["2025-26", 126_000, 25_200],
      ["2026-27", 126_000, 25_200],
    ]);
  });

  it("reproduces HMRC's 2018 transfer-rounding boundary", () => {
    const fixture = marriageAllowanceFixtures.official.transferRounding2018;
    const rule = marriageAllowanceRuleSet.rules.find(
      ({ taxYear }) => taxYear === fixture.taxYear,
    );

    expect(rule).toMatchObject({
      transferableAllowancePence:
        fixture.expectedTransferableAllowancePence,
      maximumRecipientReductionPence:
        fixture.expectedMaximumReductionPence,
    });
  });

  it("reproduces the current GOV.UK household example", () => {
    const fixture = marriageAllowanceFixtures.official.govUkWorkedExample;
    const result = calculateMarriageAllowance(fixture.request);

    expect(result.status).toBe(fixture.expected.status);
    expect(result.taxImpact).toMatchObject({
      available: true,
      donor: { taxDeltaPence: fixture.expected.donorTaxDeltaPence },
      recipient: {
        taxDeltaPence: fixture.expected.recipientTaxDeltaPence,
      },
      household: {
        netSavingPence: fixture.expected.householdNetSavingPence,
      },
    });
  });

  it.each(marriageAllowanceFixtures.syntheticHouseholds)(
    "matches the synthetic household fixture $id",
    ({ request: fixtureRequest, expectedStatus }) => {
      expect(calculateMarriageAllowance(fixtureRequest).status).toBe(
        expectedStatus,
      );
    },
  );

  it("uses the fixed basic-rate reduction for a Scottish intermediate-rate recipient", () => {
    const result = calculateMarriageAllowance(
      request({
        donor: {
          ...request().donor,
          jurisdiction: "scotland",
        },
        recipient: {
          ...request().recipient,
          jurisdiction: "scotland",
          annualNonSavingsNonDividendIncomePence: 4_366_200,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      taxImpact: {
        available: true,
        recipient: {
          maximumReductionPence: 25_200,
          actualReductionPence: 25_200,
          taxBeforeBands: expect.arrayContaining([
            expect.objectContaining({ name: "intermediate" }),
          ]),
        },
      },
    });
  });

  it("checks the donor's rate position after reducing their allowance", () => {
    const atBoundary = calculateMarriageAllowance(
      request({
        donor: {
          ...request().donor,
          annualNonSavingsNonDividendIncomePence: 4_901_000,
        },
      }),
    );
    const aboveBoundary = calculateMarriageAllowance(
      request({
        donor: {
          ...request().donor,
          annualNonSavingsNonDividendIncomePence: 4_901_001,
        },
      }),
    );

    expect(atBoundary.status).toBe("eligible");
    expect(aboveBoundary).toMatchObject({
      status: "ineligible",
      issues: [expect.objectContaining({ code: "disqualifying-tax-rate" })],
    });
  });

  it("caps the recipient reduction at their tax liability", () => {
    const result = calculateMarriageAllowance(
      request({
        recipient: {
          ...request().recipient,
          annualNonSavingsNonDividendIncomePence: 1_260_000,
        },
      }),
    );

    expect(result.taxImpact).toMatchObject({
      available: true,
      recipient: {
        taxBeforePence: 600,
        actualReductionPence: 600,
        taxAfterPence: 0,
      },
    });
  });

  it("keeps eligibility known but withholds the household delta for other income", () => {
    const result = calculateMarriageAllowance(
      request({
        recipient: {
          ...request().recipient,
          otherIncomeRatePosition: "eligible-rates-only",
        },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      taxImpact: {
        available: false,
        issues: [expect.objectContaining({ code: "missing-statutory-fact" })],
      },
    });
  });

  it("treats other income at a higher rate as ineligible", () => {
    const result = calculateMarriageAllowance(
      request({
        donor: {
          ...request().donor,
          otherIncomeRatePosition: "disqualifying-rate",
        },
      }),
    );

    expect(result).toMatchObject({
      status: "ineligible",
      issues: [expect.objectContaining({ code: "disqualifying-tax-rate" })],
    });
  });

  it.each([
    ["relationship", { relationship: "neither" }],
    ["tax-year relationship", { partnersForPartOfTaxYear: false }],
    ["claim-time relationship", { partnersAtClaim: false }],
    ["Married Couple's Allowance", { marriedCouplesAllowanceClaimed: true }],
    ["donor Personal Allowance", {
      donor: { ...request().donor, entitledToPersonalAllowance: false },
    }],
    ["residence", {
      recipient: {
        ...request().recipient,
        meetsResidenceRequirements: false,
      },
    }],
    ["foreign-income election", {
      donor: {
        ...request().donor,
        hasDisqualifyingPersonalAllowanceClaim: true,
      },
    }],
    ["another live election", { donorHasAnotherActiveElection: true }],
  ] as const)("returns ineligible for a failed %s condition", (_label, override) => {
    expect(
      calculateMarriageAllowance(
        request(override as Partial<MarriageAllowanceRequest>),
      ).status,
    ).toBe("ineligible");
  });

  it("returns unknown instead of inferring missing or non-standard allowance facts", () => {
    const missing = calculateMarriageAllowance(
      request({ recipientHasAnotherActiveClaim: null }),
    );
    const nonStandard = calculateMarriageAllowance(
      request({
        donor: {
          ...request().donor,
          personalAllowanceBasis: "non-standard",
        },
      }),
    );

    expect(missing).toMatchObject({
      status: "unknown",
      issues: [expect.objectContaining({ code: "missing-statutory-fact" })],
    });
    expect(nonStandard.status).toBe("unknown");
  });

  it("backdates a current-year application to the tax-year start and continues it", () => {
    const result = calculateMarriageAllowance(
      request({
        claim: { kind: "new-current-year", claimDate: "2026-11-06" },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: {
        appliesForTaxYear: true,
        effectiveFrom: "2026-04-06",
        effectiveTo: "2027-04-05",
        continuesAutomatically: true,
      },
    });
  });

  it("accepts a retrospective claim on the four-year deadline without continuing it", () => {
    const result = calculateMarriageAllowance(
      request({
        taxYear: "2022-23",
        claim: { kind: "retrospective", claimDate: "2027-04-05" },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: {
        appliesForTaxYear: true,
        backdatingDeadline: "2027-04-05",
        continuesAutomatically: false,
      },
    });
  });

  it("rejects a retrospective claim one day after the four-year deadline", () => {
    const result = calculateMarriageAllowance(
      request({
        taxYear: "2022-23",
        claim: { kind: "retrospective", claimDate: "2027-04-06" },
      }),
    );

    expect(result).toMatchObject({
      status: "ineligible",
      issues: [
        expect.objectContaining({ code: "backdating-deadline-passed" }),
      ],
    });
  });

  it("does not silently reinterpret a claim kind or invalid date", () => {
    const wrongKind = calculateMarriageAllowance(
      request({
        claim: { kind: "new-current-year", claimDate: "2027-04-06" },
      }),
    );
    const invalidDate = calculateMarriageAllowance(
      request({
        claim: { kind: "new-current-year", claimDate: "2026-02-30" },
      }),
    );

    expect(wrongKind.status).toBe("ineligible");
    expect(invalidDate.status).toBe("unknown");
  });

  it("runs an income-change cancellation to the end of the tax year", () => {
    const result = calculateMarriageAllowance(
      request({
        cancellation: {
          reason: "income-change",
          noticeDate: "2026-12-01",
        },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: {
        appliesForTaxYear: true,
        cancellationEffect: "ends-after-tax-year",
      },
    });
  });

  it("requires the applied treatment for a relationship-end cancellation", () => {
    const unresolved = calculateMarriageAllowance(
      request({
        cancellation: {
          reason: "relationship-ended",
          noticeDate: "2026-12-01",
          relationshipEndTreatment: null,
        },
      }),
    );
    const backdated = calculateMarriageAllowance(
      request({
        cancellation: {
          reason: "relationship-ended",
          noticeDate: "2026-12-01",
          relationshipEndTreatment: "tax-year-start",
        },
      }),
    );
    const yearEnd = calculateMarriageAllowance(
      request({
        cancellation: {
          reason: "relationship-ended",
          noticeDate: "2026-12-01",
          relationshipEndTreatment: "tax-year-end",
        },
      }),
    );

    expect(unresolved).toMatchObject({
      status: "unknown",
      issues: [
        expect.objectContaining({
          code: "relationship-end-treatment-unknown",
        }),
      ],
    });
    expect(backdated.status).toBe("ineligible");
    expect(yearEnd.status).toBe("eligible");
  });

  it("restores the donor's allowance when the recipient dies", () => {
    const result = calculateMarriageAllowance(
      request({ death: { person: "recipient", date: "2026-10-01" } }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: { deathEffect: "donor-allowance-restored" },
      taxImpact: {
        available: true,
        donor: { taxDeltaPence: 0 },
        recipient: { actualReductionPence: 25_200 },
        household: { netSavingPence: 25_200 },
      },
    });
  });

  it("keeps both sides of the transfer through the year when the donor dies", () => {
    const result = calculateMarriageAllowance(
      request({ death: { person: "donor", date: "2026-10-01" } }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: { deathEffect: "donor-allowance-remains-reduced" },
      taxImpact: {
        available: true,
        donor: { taxDeltaPence: 3_800 },
        household: { netSavingPence: 21_400 },
      },
    });
  });

  it("allows a retrospective claim after a partner's death", () => {
    const result = calculateMarriageAllowance(
      request({
        taxYear: "2022-23",
        partnersAtClaim: false,
        claim: { kind: "retrospective", claimDate: "2026-11-06" },
        death: { person: "donor", date: "2024-10-01" },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      claimTreatment: {
        appliesForTaxYear: true,
        continuesAutomatically: false,
        deathEffect: "none",
      },
    });
  });

  it("preserves historical recalculation and source lineage", () => {
    const result = calculateMarriageAllowance(
      request({
        taxYear: "2015-16",
        donor: {
          ...request().donor,
          annualNonSavingsNonDividendIncomePence: 1_000_000,
        },
        recipient: {
          ...request().recipient,
          annualNonSavingsNonDividendIncomePence: 2_000_000,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "eligible",
      taxImpact: {
        available: true,
        recipient: { maximumReductionPence: 21_200 },
      },
      lineage: {
        ruleSetVersion: "2026.11.0",
        ruleDatasetVersion: "2026.10.4",
        ruleId: "marriage-allowance-2015-16",
        ruleVersion: "1",
        sourceIds: expect.arrayContaining([
          "income-tax-act-2007-chapter-3a",
          "govuk-marriage-allowance",
          "hmrc-paye100060",
          "hmrc-income-tax-current-and-past",
        ]),
      },
    });
  });

  it.each([
    ["2014-15", "england-and-northern-ireland"],
    ["2026-27", "guernsey"],
  ])("returns unknown for unsupported rule input %s / %s", (taxYear, jurisdiction) => {
    const result = calculateMarriageAllowance(
      request({
        taxYear,
        recipient: { ...request().recipient, jurisdiction },
      }),
    );

    expect(result.status).toBe("unknown");
  });
});
