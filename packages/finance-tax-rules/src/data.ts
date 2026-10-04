import type { RuleDataset } from "./schema";

const gbp = (amount: number) => amount * 100;
const review = (sourceIds: string[], reviewNotes: string) => ({
  sourceIds,
  reviewedBy: "codex:finance-tax-historical-rule-data",
  reviewedAt: "2026-10-01",
  reviewNotes,
});

const common = {
  legalStatus: "enacted" as const,
  currency: "GBP" as const,
  moneyUnit: "pence" as const,
  rateUnit: "basis-points" as const,
};

const dataLicence = {
  name: "Open Government Licence v3.0" as const,
  url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" as const,
  copyright: "Crown copyright" as const,
  attribution:
    "Contains public sector information from HM Revenue & Customs licensed under the Open Government Licence v3.0.",
};

const sourceLicence = {
  licence: dataLicence.name,
  licenceUrl: dataLicence.url,
  copyright: dataLicence.copyright,
  attribution: dataLicence.attribution,
};

type SourceRecord = RuleDataset["sources"][number];
type SourceInput = Omit<
  SourceRecord,
  | "publisher"
  | "retrievalDate"
  | "licence"
  | "licenceUrl"
  | "copyright"
  | "attribution"
>;

const hmrcSource = ({
  id,
  title,
  url,
  archiveUrl,
  publicationDate,
  coverageFrom,
  coverageTo,
  sourceContentSha256,
  snapshotPath,
}: SourceInput): SourceRecord => ({
  id,
  title,
  publisher: "HM Revenue & Customs",
  url,
  archiveUrl,
  publicationDate,
  retrievalDate: "2026-10-01",
  coverageFrom,
  coverageTo,
  sourceContentSha256,
  snapshotPath,
  ...sourceLicence,
});

const standardAllowance = {
  standardPersonalAllowancePence: gbp(12_570),
  personalAllowanceTaper: {
    adjustedNetIncomeStartsAtPence: gbp(100_000),
    allowanceReductionPence: gbp(1),
    perExcessIncomePence: gbp(2),
  },
};

const mainRateBands = (additionalRateThreshold: number) => [
  { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(37_700) },
  {
    name: "higher",
    rateBasisPoints: 4_000,
    widthPence: gbp(additionalRateThreshold - 37_700),
  },
  { name: "additional", rateBasisPoints: 4_500, widthPence: null },
];

const scottishBandsFrom2024 = (
  starterWidth: number,
  basicWidth: number,
  intermediateWidth: number,
): RuleDataset["incomeTax"][number]["bands"] => [
  { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(starterWidth) },
  { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(basicWidth) },
  {
    name: "intermediate",
    rateBasisPoints: 2_100,
    widthPence: gbp(intermediateWidth),
  },
  { name: "higher", rateBasisPoints: 4_200, widthPence: gbp(31_338) },
  { name: "advanced", rateBasisPoints: 4_500, widthPence: gbp(62_710) },
  { name: "top", rateBasisPoints: 4_800, widthPence: null },
];

const taxRule = (
  id: string,
  taxYear: string,
  effectiveFrom: string,
  effectiveTo: string,
  jurisdictions: RuleDataset["incomeTax"][number]["jurisdictions"],
  bands: RuleDataset["incomeTax"][number]["bands"],
  sourceId: string,
): RuleDataset["incomeTax"][number] => ({
  ...common,
  id,
  version: "1",
  taxYear,
  effectiveFrom,
  effectiveTo,
  kind: "income-tax",
  jurisdictions,
  incomeScope: "employment-non-savings-non-dividend",
  calculationScope: "annual-liability",
  ...standardAllowance,
  bands,
  provenance: review(
    ["hmrc-income-tax-current-and-past", sourceId],
    "Checked against both HMRC's summary table and its year-specific employer guidance.",
  ),
});

const threshold = (weekly: number, monthly: number) => ({
  weekly: gbp(weekly),
  monthly: gbp(monthly),
});

type PayPeriodThreshold = { weekly: number; monthly: number };

type NationalInsuranceRuleInput = {
  id: string;
  taxYear: string;
  effectiveFrom: string;
  effectiveTo: string;
  sourceId: string;
  lowerEarningsLimit: PayPeriodThreshold;
  primaryThreshold: PayPeriodThreshold;
  upperEarningsLimit: PayPeriodThreshold;
  mainRate: number;
  upperRate: number;
};

const niRule = ({
  id,
  taxYear,
  effectiveFrom,
  effectiveTo,
  sourceId,
  lowerEarningsLimit,
  primaryThreshold,
  upperEarningsLimit,
  mainRate,
  upperRate,
}: NationalInsuranceRuleInput): RuleDataset["nationalInsurance"][number] => ({
  ...common,
  id,
  version: "1",
  taxYear,
  effectiveFrom,
  effectiveTo,
  kind: "class-1-national-insurance",
  category: "A",
  employmentType: "employee-not-director",
  thresholds: {
    lowerEarningsLimitPence: threshold(
      lowerEarningsLimit.weekly,
      lowerEarningsLimit.monthly,
    ),
    primaryThresholdPence: threshold(
      primaryThreshold.weekly,
      primaryThreshold.monthly,
    ),
    upperEarningsLimitPence: threshold(
      upperEarningsLimit.weekly,
      upperEarningsLimit.monthly,
    ),
  },
  rates: {
    atOrBelowPrimaryThresholdBasisPoints: 0,
    primaryToUpperBasisPoints: mainRate,
    aboveUpperBasisPoints: upperRate,
  },
  provenance: review(
    [sourceId],
    "Transcribed from the employee Class 1 table for category A; director calculations are excluded.",
  ),
});

const pensionMethods = (): RuleDataset["pensions"][number]["methods"] => [
  {
    method: "salary-sacrifice",
    memberContribution: false,
    reducesContractualCashPay: true,
    deductedBeforeIncomeTax: true,
    deductedBeforeEmployeeNationalInsurance: true,
    providerReliefBasisPoints: 0,
    furtherReliefMayRequireClaim: false,
  },
  {
    method: "net-pay",
    memberContribution: true,
    reducesContractualCashPay: false,
    deductedBeforeIncomeTax: true,
    deductedBeforeEmployeeNationalInsurance: false,
    providerReliefBasisPoints: 0,
    furtherReliefMayRequireClaim: false,
  },
  {
    method: "relief-at-source",
    memberContribution: true,
    reducesContractualCashPay: false,
    deductedBeforeIncomeTax: false,
    deductedBeforeEmployeeNationalInsurance: false,
    providerReliefBasisPoints: 2_000,
    furtherReliefMayRequireClaim: true,
  },
];

const pensionRule = (
  taxYear: string,
  effectiveFrom: string,
  effectiveTo: string,
  annualAllowance: number,
  adjustedIncomeLimit: number,
  minimumAllowance: number,
  moneyPurchaseAnnualAllowance: number,
): RuleDataset["pensions"][number] => ({
  ...common,
  id: `pension-${taxYear}`,
  version: "1",
  taxYear,
  effectiveFrom,
  effectiveTo,
  kind: "pension",
  jurisdictions: [
    "england-and-northern-ireland",
    "scotland",
    "wales",
  ],
  reliefLimit: {
    relevantUkEarningsPercent: 100,
    basicAmountPence: gbp(3_600),
  },
  annualAllowancePence: gbp(annualAllowance),
  taperedAnnualAllowance: {
    thresholdIncomeLimitPence: gbp(200_000),
    adjustedIncomeLimitPence: gbp(adjustedIncomeLimit),
    minimumAllowancePence: gbp(minimumAllowance),
  },
  moneyPurchaseAnnualAllowancePence: gbp(moneyPurchaseAnnualAllowance),
  methods: pensionMethods(),
  provenance: review(
    [
      "hmrc-pension-scheme-rates",
      "hmrc-pension-relief-at-source",
      "hmrc-pension-net-pay",
      "hmrc-salary-sacrifice",
    ],
    "Allowance values and the payroll effects of each contribution method were reviewed separately.",
  ),
});

const householdTaxRule = (
  taxYear: "2025-26" | "2026-27",
  effectiveFrom: string,
  effectiveTo: string,
  dividendBasicRate: number,
  dividendHigherRate: number,
): RuleDataset["householdTax"][number] => ({
  ...common,
  id: `household-tax-${taxYear}`,
  version: "1",
  taxYear,
  effectiveFrom,
  effectiveTo,
  kind: "household-tax",
  jurisdictions: [
    "england-and-northern-ireland",
    "scotland",
    "wales",
  ],
  dividendAllowancePence: gbp(500),
  dividendRates: {
    basicBasisPoints: dividendBasicRate,
    higherBasisPoints: dividendHigherRate,
    additionalBasisPoints: 3_935,
  },
  savings: {
    startingRateLimitPence: gbp(5_000),
    personalSavingsAllowancePence: {
      basic: gbp(1_000),
      higher: gbp(500),
      additional: 0,
    },
    rates: {
      basicBasisPoints: 2_000,
      higherBasisPoints: 4_000,
      additionalBasisPoints: 4_500,
    },
  },
  capitalGains: {
    annualExemptAmountPence: gbp(3_000),
    basicRateBasisPoints: 1_800,
    higherRateBasisPoints: 2_400,
  },
  isaAnnualAllowancePence: gbp(20_000),
  provenance: review(
    [
      "hmrc-income-tax-current-and-past",
      "hmrc-tax-on-savings-interest",
      "hmrc-capital-gains-rates-and-allowances",
      "hmrc-isa-overview",
    ],
    "Savings, dividend, Capital Gains Tax, and ISA limits were checked against HMRC guidance for each supported tax year.",
  ),
});

export const ruleDataset = {
  datasetVersion: "2026.10.2",
  releasedAt: "2026-10-04",
  supersedes: "2026.10.1",
  corrections: [],
  dataLicence,
  sources: [
    hmrcSource({
      id: "hmrc-income-tax-current-and-past",
      title: "Income Tax rates and allowances for current and previous tax years",
      url: "https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past",
      archiveUrl: null,
      publicationDate: "2014-02-01",
      coverageFrom: "2022-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "89b4d254fc3303af663cd405c1f5a880400e4890364fd774e851557c4fa67263",
      snapshotPath: "source-snapshots/income-tax-current-and-past.md",
    }),
    ...[
      ["2022-23", "2022-02-07", "2022-04-06", "2023-04-05", "33bd9fa84534216d2a6a4fd5e35273f9c989eba771f845e9bdcfa8e3ce014c64"],
      ["2023-24", "2023-02-27", "2023-04-06", "2024-04-05", "42b48eb2abd884ac3997b9a073f5b04ccb2a97ccfb43150fdc6e5d181e86cae7"],
      ["2024-25", "2024-02-06", "2024-04-06", "2025-04-05", "cc3304f6650804bc9578557f8897e713cd1dcd22e4bc1b27a234c5f191a80943"],
      ["2025-26", "2025-01-31", "2025-04-06", "2026-04-05", "a62aea50942fdf008f7a2afad9dd1746354df7e3b98edce03fe7db596e540eca"],
      ["2026-27", "2026-01-30", "2026-04-06", "2027-04-05", "a6315ba6c7166c712c66094523334ab27b1f94f9922af74a223c6380d20fc7d0"],
    ].map(([year, publicationDate, coverageFrom, coverageTo, sourceContentSha256]) => hmrcSource({
      id: `hmrc-employer-${year}`,
      title: `Rates and thresholds for employers ${year?.slice(0, 4)} to 20${year?.slice(5)}`,
      url: `https://www.gov.uk/guidance/rates-and-thresholds-for-employers-${year?.slice(0, 4)}-to-20${year?.slice(5)}`,
      archiveUrl:
        year === "2022-23"
          ? "https://webarchive.nationalarchives.gov.uk/ukgwa/*/https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2022-to-2023"
          : null,
      publicationDate: publicationDate ?? "",
      coverageFrom: coverageFrom ?? "",
      coverageTo: coverageTo ?? "",
      sourceContentSha256: sourceContentSha256 ?? "",
      snapshotPath: `source-snapshots/employer-${year}.md`,
    })),
    hmrcSource({
      id: "hmrc-pension-scheme-rates",
      title: "Pension schemes rates",
      url: "https://www.gov.uk/government/publications/rates-and-allowances-pension-schemes/pension-schemes-rates",
      archiveUrl: null,
      publicationDate: "2014-02-01",
      coverageFrom: "2022-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "90652c9268a5e0e1f46fa27bfc3549cc01d23c45ae340916c2c6561409c78ef8",
      snapshotPath: "source-snapshots/pension-scheme-rates.md",
    }),
    hmrcSource({
      id: "hmrc-pension-relief-at-source",
      title: "PTM044220: relief at source",
      url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm044220",
      archiveUrl: null,
      publicationDate: "2015-03-27",
      coverageFrom: "2022-04-06",
      coverageTo: null,
      sourceContentSha256:
        "554eb9d33a0f76ba18b11dd466988c9f0b3042b5e7c5a7b2d059019a3d16405b",
      snapshotPath: "source-snapshots/pension-relief-at-source.md",
    }),
    hmrcSource({
      id: "hmrc-pension-net-pay",
      title: "PTM044230: net pay",
      url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm044230",
      archiveUrl: null,
      publicationDate: "2015-03-27",
      coverageFrom: "2022-04-06",
      coverageTo: null,
      sourceContentSha256:
        "aade57fbc5948c3f3a21c9392502c71414099e53fe98e7f6ceb1a4283080a34b",
      snapshotPath: "source-snapshots/pension-net-pay.md",
    }),
    hmrcSource({
      id: "hmrc-salary-sacrifice",
      title: "Salary sacrifice for employers",
      url: "https://www.gov.uk/guidance/salary-sacrifice-and-the-effects-on-paye",
      archiveUrl: null,
      publicationDate: "2014-06-12",
      coverageFrom: "2022-04-06",
      coverageTo: null,
      sourceContentSha256:
        "bd8fa64edd90b24e7a21008ba84b8ab71aaac1db48e902b3141b6ebd7a1e6857",
      snapshotPath: "source-snapshots/salary-sacrifice.md",
    }),
    hmrcSource({
      id: "hmrc-tax-on-savings-interest",
      title: "Tax on savings interest: how much is tax free",
      url: "https://www.gov.uk/apply-tax-free-interest-on-savings/how-much-is-tax-free",
      archiveUrl: null,
      publicationDate: "2012-01-25",
      coverageFrom: "2025-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "fd17a54431051eec5c8f09076baf07b35c3e20ad957858fc043c6312a8360554",
      snapshotPath: "source-snapshots/tax-on-savings-interest.md",
    }),
    hmrcSource({
      id: "hmrc-capital-gains-rates-and-allowances",
      title: "Capital Gains Tax rates and allowances",
      url: "https://www.gov.uk/guidance/capital-gains-tax-rates-and-allowances",
      archiveUrl: null,
      publicationDate: "2018-04-06",
      coverageFrom: "2025-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "d2b662859a7ea7e35913425c3005c90d24a572cdec3f2cda14898a964e42a198",
      snapshotPath: "source-snapshots/capital-gains-rates-and-allowances.md",
    }),
    hmrcSource({
      id: "hmrc-isa-overview",
      title: "Individual Savings Accounts: overview",
      url: "https://www.gov.uk/individual-savings-accounts/overview",
      archiveUrl: null,
      publicationDate: "2014-04-05",
      coverageFrom: "2025-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "748e1c62ce74773bf9a0b43e11ac48735d802c3cc85a8a7ffc6fc1570a12b6c0",
      snapshotPath: "source-snapshots/isa-overview.md",
    }),
  ],
  incomeTax: [
    taxRule(
      "income-tax-2022-23-england-northern-ireland",
      "2022-23",
      "2022-04-06",
      "2023-04-05",
      ["england-and-northern-ireland"],
      mainRateBands(150_000),
      "hmrc-employer-2022-23",
    ),
    taxRule(
      "income-tax-2022-23-wales",
      "2022-23",
      "2022-04-06",
      "2023-04-05",
      ["wales"],
      mainRateBands(150_000),
      "hmrc-employer-2022-23",
    ),
    taxRule(
      "income-tax-2022-23-scotland",
      "2022-23",
      "2022-04-06",
      "2023-04-05",
      ["scotland"],
      [
        { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_162) },
        { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_956) },
        { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(17_974) },
        { name: "higher", rateBasisPoints: 4_100, widthPence: gbp(118_908) },
        { name: "top", rateBasisPoints: 4_600, widthPence: null },
      ],
      "hmrc-employer-2022-23",
    ),
    taxRule(
      "income-tax-2023-24-england-northern-ireland",
      "2023-24",
      "2023-04-06",
      "2024-04-05",
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2023-24",
    ),
    taxRule(
      "income-tax-2023-24-wales",
      "2023-24",
      "2023-04-06",
      "2024-04-05",
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2023-24",
    ),
    taxRule(
      "income-tax-2023-24-scotland",
      "2023-24",
      "2023-04-06",
      "2024-04-05",
      ["scotland"],
      [
        { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_162) },
        { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_956) },
        { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(17_974) },
        { name: "higher", rateBasisPoints: 4_200, widthPence: gbp(94_048) },
        { name: "top", rateBasisPoints: 4_700, widthPence: null },
      ],
      "hmrc-employer-2023-24",
    ),
    taxRule(
      "income-tax-2024-25-england-northern-ireland",
      "2024-25",
      "2024-04-06",
      "2025-04-05",
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2024-25-wales",
      "2024-25",
      "2024-04-06",
      "2025-04-05",
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2024-25-scotland",
      "2024-25",
      "2024-04-06",
      "2025-04-05",
      ["scotland"],
      scottishBandsFrom2024(2_306, 11_685, 17_101),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2025-26-england-northern-ireland",
      "2025-26",
      "2025-04-06",
      "2026-04-05",
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2025-26-wales",
      "2025-26",
      "2025-04-06",
      "2026-04-05",
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2025-26-scotland",
      "2025-26",
      "2025-04-06",
      "2026-04-05",
      ["scotland"],
      scottishBandsFrom2024(2_827, 12_094, 16_171),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2026-27-england-northern-ireland",
      "2026-27",
      "2026-04-06",
      "2027-04-05",
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2026-27",
    ),
    taxRule(
      "income-tax-2026-27-wales",
      "2026-27",
      "2026-04-06",
      "2027-04-05",
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2026-27",
    ),
    taxRule(
      "income-tax-2026-27-scotland",
      "2026-27",
      "2026-04-06",
      "2027-04-05",
      ["scotland"],
      scottishBandsFrom2024(3_967, 12_989, 14_136),
      "hmrc-employer-2026-27",
    ),
  ],
  nationalInsurance: [
    niRule({
      id: "ni-2022-23-a",
      taxYear: "2022-23",
      effectiveFrom: "2022-04-06",
      effectiveTo: "2022-07-05",
      sourceId: "hmrc-employer-2022-23",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 190, monthly: 823 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 1_325,
      upperRate: 325,
    }),
    niRule({
      id: "ni-2022-23-b",
      taxYear: "2022-23",
      effectiveFrom: "2022-07-06",
      effectiveTo: "2022-11-05",
      sourceId: "hmrc-employer-2022-23",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 1_325,
      upperRate: 325,
    }),
    niRule({
      id: "ni-2022-23-c",
      taxYear: "2022-23",
      effectiveFrom: "2022-11-06",
      effectiveTo: "2023-04-05",
      sourceId: "hmrc-employer-2022-23",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 1_200,
      upperRate: 200,
    }),
    niRule({
      id: "ni-2023-24-a",
      taxYear: "2023-24",
      effectiveFrom: "2023-04-06",
      effectiveTo: "2024-01-05",
      sourceId: "hmrc-employer-2023-24",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 1_200,
      upperRate: 200,
    }),
    niRule({
      id: "ni-2023-24-b",
      taxYear: "2023-24",
      effectiveFrom: "2024-01-06",
      effectiveTo: "2024-04-05",
      sourceId: "hmrc-employer-2023-24",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 1_000,
      upperRate: 200,
    }),
    niRule({
      id: "ni-2024-25",
      taxYear: "2024-25",
      effectiveFrom: "2024-04-06",
      effectiveTo: "2025-04-05",
      sourceId: "hmrc-employer-2024-25",
      lowerEarningsLimit: { weekly: 123, monthly: 533 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 800,
      upperRate: 200,
    }),
    niRule({
      id: "ni-2025-26",
      taxYear: "2025-26",
      effectiveFrom: "2025-04-06",
      effectiveTo: "2026-04-05",
      sourceId: "hmrc-employer-2025-26",
      lowerEarningsLimit: { weekly: 125, monthly: 542 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 800,
      upperRate: 200,
    }),
    niRule({
      id: "ni-2026-27",
      taxYear: "2026-27",
      effectiveFrom: "2026-04-06",
      effectiveTo: "2027-04-05",
      sourceId: "hmrc-employer-2026-27",
      lowerEarningsLimit: { weekly: 129, monthly: 559 },
      primaryThreshold: { weekly: 242, monthly: 1_048 },
      upperEarningsLimit: { weekly: 967, monthly: 4_189 },
      mainRate: 800,
      upperRate: 200,
    }),
  ],
  pensions: [
    pensionRule("2022-23", "2022-04-06", "2023-04-05", 40_000, 240_000, 4_000, 4_000),
    pensionRule("2023-24", "2023-04-06", "2024-04-05", 60_000, 260_000, 10_000, 10_000),
    pensionRule("2024-25", "2024-04-06", "2025-04-05", 60_000, 260_000, 10_000, 10_000),
    pensionRule("2025-26", "2025-04-06", "2026-04-05", 60_000, 260_000, 10_000, 10_000),
    pensionRule("2026-27", "2026-04-06", "2027-04-05", 60_000, 260_000, 10_000, 10_000),
  ],
  householdTax: [
    householdTaxRule(
      "2025-26",
      "2025-04-06",
      "2026-04-05",
      875,
      3_375,
    ),
    householdTaxRule(
      "2026-27",
      "2026-04-06",
      "2027-04-05",
      1_075,
      3_575,
    ),
  ],
} satisfies RuleDataset;
