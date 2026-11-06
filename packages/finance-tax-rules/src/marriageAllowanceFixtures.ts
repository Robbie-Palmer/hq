import type { MarriageAllowanceRequest } from "./marriageAllowance";

const eligibleRequest = (
  overrides: Partial<MarriageAllowanceRequest> = {},
): MarriageAllowanceRequest => ({
  taxYear: "2026-27",
  relationship: "married",
  partnersForPartOfTaxYear: true,
  partnersAtClaim: true,
  marriedCouplesAllowanceClaimed: false,
  donorHasAnotherActiveElection: false,
  recipientHasAnotherActiveClaim: false,
  donor: {
    jurisdiction: "england-and-northern-ireland",
    meetsResidenceRequirements: true,
    hasDisqualifyingPersonalAllowanceClaim: false,
    personalAllowanceBasis: "standard",
    entitledToPersonalAllowance: true,
    annualNonSavingsNonDividendIncomePence: 1_150_000,
    otherIncomeRatePosition: "none",
  },
  recipient: {
    jurisdiction: "england-and-northern-ireland",
    meetsResidenceRequirements: true,
    hasDisqualifyingPersonalAllowanceClaim: false,
    personalAllowanceBasis: "standard",
    annualNonSavingsNonDividendIncomePence: 2_000_000,
    otherIncomeRatePosition: "none",
  },
  claim: { kind: "continuing" },
  cancellation: null,
  death: null,
  ...overrides,
});

export const marriageAllowanceFixtures = {
  fixtureVersion: "2026.11.0",
  ruleSetVersion: "2026.11.0",
  ruleDatasetVersion: "2026.10.4",
  releasedAt: "2026-11-06",
  official: {
    govUkWorkedExample: {
      source: {
        title: "Marriage Allowance: How it works",
        url: "https://www.gov.uk/marriage-allowance",
      },
      description:
        "A £11,500 donor and £20,000 recipient save £214 after the donor pays £38 and the recipient receives a £252 reduction.",
      request: eligibleRequest(),
      expected: {
        status: "eligible",
        donorTaxDeltaPence: 3_800,
        recipientTaxDeltaPence: -25_200,
        householdNetSavingPence: 21_400,
      },
    },
    transferRounding2018: {
      source: {
        title: "PAYE100060: marriage allowance",
        url: "https://www.gov.uk/hmrc-internal-manuals/paye-manual/paye100060",
      },
      description:
        "Ten per cent of the £11,850 Personal Allowance rounds from £1,185 up to £1,190.",
      taxYear: "2018-19",
      expectedTransferableAllowancePence: 119_000,
      expectedMaximumReductionPence: 23_800,
    },
  },
  syntheticHouseholds: [
    {
      id: "england-basic-rate-ceiling",
      description:
        "The recipient remains eligible at the final penny of the England and Northern Ireland basic-rate band.",
      request: eligibleRequest({
        taxYear: "2025-26",
        recipient: {
          ...eligibleRequest().recipient,
          annualNonSavingsNonDividendIncomePence: 5_027_000,
        },
      }),
      expectedStatus: "eligible",
    },
    {
      id: "england-one-penny-into-higher-rate",
      description:
        "One penny in the higher-rate band makes the recipient ineligible.",
      request: eligibleRequest({
        taxYear: "2025-26",
        recipient: {
          ...eligibleRequest().recipient,
          annualNonSavingsNonDividendIncomePence: 5_027_001,
        },
      }),
      expectedStatus: "ineligible",
    },
    {
      id: "scotland-intermediate-rate-ceiling",
      description:
        "A Scottish recipient remains eligible at the top of the intermediate-rate band.",
      request: eligibleRequest({
        donor: {
          ...eligibleRequest().donor,
          jurisdiction: "scotland",
        },
        recipient: {
          ...eligibleRequest().recipient,
          jurisdiction: "scotland",
          annualNonSavingsNonDividendIncomePence: 4_366_200,
        },
      }),
      expectedStatus: "eligible",
    },
    {
      id: "scotland-one-penny-into-higher-rate",
      description:
        "One penny in the Scottish higher-rate band makes the recipient ineligible.",
      request: eligibleRequest({
        donor: {
          ...eligibleRequest().donor,
          jurisdiction: "scotland",
        },
        recipient: {
          ...eligibleRequest().recipient,
          jurisdiction: "scotland",
          annualNonSavingsNonDividendIncomePence: 4_366_201,
        },
      }),
      expectedStatus: "ineligible",
    },
    {
      id: "welsh-basic-rate-household",
      description:
        "A Welsh basic-rate recipient receives the same fixed reduction as the rest of the UK.",
      request: eligibleRequest({
        donor: {
          ...eligibleRequest().donor,
          jurisdiction: "wales",
        },
        recipient: {
          ...eligibleRequest().recipient,
          jurisdiction: "wales",
        },
      }),
      expectedStatus: "eligible",
    },
    {
      id: "married-couples-allowance-is-separate",
      description:
        "A Married Couple's Allowance claim makes Marriage Allowance unavailable.",
      request: eligibleRequest({ marriedCouplesAllowanceClaimed: true }),
      expectedStatus: "ineligible",
    },
    {
      id: "unknown-other-income-position",
      description:
        "The result remains unknown when the recipient's other-income rate position is missing.",
      request: eligibleRequest({
        recipient: {
          ...eligibleRequest().recipient,
          otherIncomeRatePosition: null,
        },
      }),
      expectedStatus: "unknown",
    },
  ] satisfies Array<{
    id: string;
    description: string;
    request: MarriageAllowanceRequest;
    expectedStatus: "eligible" | "ineligible" | "unknown";
  }>,
} as const;

export { eligibleRequest as marriageAllowanceFixtureRequest };
