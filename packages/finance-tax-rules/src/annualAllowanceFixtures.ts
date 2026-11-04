import type {
  PensionAnnualAllowanceIncome,
  PensionAnnualAllowanceRequest,
  PensionInput,
} from "./annualAllowance";

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

export const pensionAnnualAllowanceFixtures = {
  jonTaper: {
    source: {
      title: "PTM057200 full worked example",
      url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm057200",
    },
    taxYear: "2016-17",
    income: {
      ...zeroIncome(),
      netIncomePence: 14_450_000,
      reliefAtSourceNetContributionsPence: 432_000,
      netPayContributionsPence: 1_400_000,
    },
    pensionInputs: [
      {
        id: "personal-pension",
        schemeId: "personal",
        arrangement: "money-purchase",
        inputPence: 540_000,
      },
      {
        id: "career-average",
        schemeId: "employer",
        arrangement: "defined-benefit",
        inputPence: 3_400_000,
      },
    ] satisfies PensionInput[],
    expected: {
      reliefAtSourceGrossContributionsPence: 540_000,
      thresholdIncomePence: 13_910_000,
      adjustedIncomePence: 17_850_000,
      taperedAnnualAllowancePence: 2_575_000,
    },
  },
  dwayneMpaa: {
    source: {
      title: "PTM056540 example 2",
      url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056540",
    },
    request: {
      taxYear: "2016-17",
      jurisdiction: "england-and-northern-ireland",
      income: zeroIncome(),
      pensionInputs: [
        {
          id: "cash-balance",
          schemeId: "cash-balance-scheme",
          arrangement: "money-purchase",
          inputPence: 1_200_000,
          postFlexibleAccessInputPence: 664_100,
        },
        {
          id: "other-money-purchase",
          schemeId: "dc-scheme",
          arrangement: "money-purchase",
          inputPence: 2_300_000,
          postFlexibleAccessInputPence: 800_000,
        },
      ],
      priorYears: [
        {
          taxYear: "2013-14",
          registeredSchemeMember: false,
          annualAllowancePence: null,
          pensionInputPence: null,
        },
        {
          taxYear: "2014-15",
          registeredSchemeMember: false,
          annualAllowancePence: null,
          pensionInputPence: null,
        },
        {
          taxYear: "2015-16",
          registeredSchemeMember: false,
          annualAllowancePence: null,
          pensionInputPence: null,
        },
      ],
      flexibleAccessDate: "2016-09-15",
      charge: {
        reducedNetIncomePence: 0,
        rateBands: [{ upperLimitPence: null, rateBasisPoints: 2_000 }],
      },
      schemePays: { status: "none" },
    } satisfies PensionAnnualAllowanceRequest,
    expected: {
      testedInputPence: 1_464_100,
      otherInputPence: 2_035_900,
      alternativeAnnualAllowancePence: 3_000_000,
      defaultChargeablePence: 0,
      alternativeChargeablePence: 464_100,
    },
  },
  traceySchemePays: {
    source: {
      title: "PTM056410 Scheme Pays example",
      url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056410",
    },
    request: {
      taxYear: "2016-17",
      jurisdiction: "england-and-northern-ireland",
      income: {
        ...zeroIncome(),
        netIncomePence: 13_000_000,
        reliefAtSourceNetContributionsPence: 1_680_000,
      },
      pensionInputs: [
        {
          id: "scheme-1-input",
          schemeId: "scheme-1",
          arrangement: "money-purchase",
          inputPence: 5_800_000,
        },
        {
          id: "scheme-2-input",
          schemeId: "scheme-2",
          arrangement: "defined-benefit",
          inputPence: 3_700_000,
        },
      ],
      priorYears: [
        {
          taxYear: "2013-14",
          registeredSchemeMember: true,
          annualAllowancePence: 5_000_000,
          pensionInputPence: 2_000_000,
        },
        {
          taxYear: "2014-15",
          registeredSchemeMember: false,
          annualAllowancePence: null,
          pensionInputPence: null,
        },
        {
          taxYear: "2015-16",
          registeredSchemeMember: false,
          annualAllowancePence: null,
          pensionInputPence: null,
        },
      ],
      flexibleAccessDate: null,
      charge: {
        reducedNetIncomePence: 13_000_000,
        rateBands: [
          { upperLimitPence: 4_000_000, rateBasisPoints: 2_000 },
          { upperLimitPence: 15_000_000, rateBasisPoints: 4_000 },
          { upperLimitPence: null, rateBasisPoints: 4_500 },
        ],
      },
      schemePays: {
        status: "observed-election",
        schemeId: "scheme-1",
        amountPence: 745_000,
      },
    } satisfies PensionAnnualAllowanceRequest,
    expected: {
      chargeablePence: 2_500_000,
      annualAllowanceChargePence: 1_025_000,
      mandatoryEligibleSchemeIds: ["scheme-1"],
      mandatoryMaximumPence: 745_000,
      memberRemainsLiablePence: 280_000,
    },
  },
} as const;
