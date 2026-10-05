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
  publisher = "HM Revenue & Customs",
  retrievalDate = "2026-10-01",
}: SourceInput & {
  publisher?: string;
  retrievalDate?: string;
}): SourceRecord => ({
  id,
  title,
  publisher,
  url,
  archiveUrl,
  publicationDate,
  retrievalDate,
  coverageFrom,
  coverageTo,
  sourceContentSha256,
  snapshotPath,
  ...sourceLicence,
});

const standardAllowance = (amount: number) => ({
  standardPersonalAllowancePence: gbp(amount),
  personalAllowanceTaper: {
    adjustedNetIncomeStartsAtPence: gbp(100_000),
    allowanceReductionPence: gbp(1),
    perExcessIncomePence: gbp(2),
  },
});

const mainRateBands = (
  additionalRateThreshold: number,
  basicRateBand = 37_700,
) => [
  { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(basicRateBand) },
  {
    name: "higher",
    rateBasisPoints: 4_000,
    widthPence: gbp(additionalRateThreshold - basicRateBand),
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

type EffectiveDates = {
  effectiveFrom: string;
  effectiveTo: string;
};

const effectiveDates = (
  effectiveFrom: string,
  effectiveTo: string,
): EffectiveDates => ({ effectiveFrom, effectiveTo });

const taxRule = (
  id: string,
  taxYear: string,
  dates: EffectiveDates,
  jurisdictions: RuleDataset["incomeTax"][number]["jurisdictions"],
  bands: RuleDataset["incomeTax"][number]["bands"],
  sourceId: string,
  personalAllowance = 12_570,
): RuleDataset["incomeTax"][number] => ({
  ...common,
  id,
  version: "1",
  taxYear,
  ...dates,
  kind: "income-tax",
  jurisdictions,
  incomeScope: "employment-non-savings-non-dividend",
  calculationScope: "annual-liability",
  ...standardAllowance(personalAllowance),
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

type TaperedAnnualAllowance = {
  thresholdIncomeLimit: number;
  adjustedIncomeLimit: number;
  minimumAllowance: number;
};

const pensionRule = (
  id: string,
  taxYear: string,
  dates: EffectiveDates,
  annualAllowance: number,
  annualAllowanceNotes: string[],
  taperedAnnualAllowance: TaperedAnnualAllowance | null,
  moneyPurchaseAnnualAllowance: number,
): RuleDataset["pensions"][number] => ({
  ...common,
  id,
  version: "1",
  taxYear,
  ...dates,
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
  annualAllowanceNotes,
  taperedAnnualAllowance:
    taperedAnnualAllowance == null
      ? null
      : {
          thresholdIncomeLimitPence: gbp(
            taperedAnnualAllowance.thresholdIncomeLimit,
          ),
          adjustedIncomeLimitPence: gbp(
            taperedAnnualAllowance.adjustedIncomeLimit,
          ),
          minimumAllowancePence: gbp(
            taperedAnnualAllowance.minimumAllowance,
          ),
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

const historicalIncomeTaxRules: RuleDataset["incomeTax"] = [
  {
    taxYear: "2015-16",
    personalAllowance: 10_600,
    basicRateBand: 31_785,
    scottishBands: mainRateBands(150_000, 31_785),
  },
  {
    taxYear: "2016-17",
    personalAllowance: 11_000,
    basicRateBand: 32_000,
    scottishBands: mainRateBands(150_000, 32_000),
  },
  {
    taxYear: "2017-18",
    personalAllowance: 11_500,
    basicRateBand: 33_500,
    scottishBands: mainRateBands(150_000, 31_500),
  },
  {
    taxYear: "2018-19",
    personalAllowance: 11_850,
    basicRateBand: 34_500,
    scottishBands: [
      { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_000) },
      { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_150) },
      { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(19_430) },
      { name: "higher", rateBasisPoints: 4_100, widthPence: gbp(118_420) },
      { name: "top", rateBasisPoints: 4_600, widthPence: null },
    ],
  },
  {
    taxYear: "2019-20",
    personalAllowance: 12_500,
    basicRateBand: 37_500,
    scottishBands: [
      { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_049) },
      { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_395) },
      { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(18_486) },
      { name: "higher", rateBasisPoints: 4_100, widthPence: gbp(119_070) },
      { name: "top", rateBasisPoints: 4_600, widthPence: null },
    ],
  },
  {
    taxYear: "2020-21",
    personalAllowance: 12_500,
    basicRateBand: 37_500,
    scottishBands: [
      { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_085) },
      { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_573) },
      { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(18_272) },
      { name: "higher", rateBasisPoints: 4_100, widthPence: gbp(119_070) },
      { name: "top", rateBasisPoints: 4_600, widthPence: null },
    ],
  },
  {
    taxYear: "2021-22",
    personalAllowance: 12_570,
    basicRateBand: 37_700,
    scottishBands: [
      { name: "starter", rateBasisPoints: 1_900, widthPence: gbp(2_097) },
      { name: "basic", rateBasisPoints: 2_000, widthPence: gbp(10_629) },
      { name: "intermediate", rateBasisPoints: 2_100, widthPence: gbp(18_366) },
      { name: "higher", rateBasisPoints: 4_100, widthPence: gbp(118_908) },
      { name: "top", rateBasisPoints: 4_600, widthPence: null },
    ],
  },
].flatMap(({ taxYear, personalAllowance, basicRateBand, scottishBands }) => {
  const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
  const effectiveFrom = `${startYear}-04-06`;
  const effectiveTo = `${startYear + 1}-04-05`;
  const sourceId = `hmrc-employer-${taxYear}`;
  return [
    taxRule(
      `income-tax-${taxYear}-england-northern-ireland`,
      taxYear,
      effectiveDates(effectiveFrom, effectiveTo),
      ["england-and-northern-ireland"],
      mainRateBands(150_000, basicRateBand),
      sourceId,
      personalAllowance,
    ),
    taxRule(
      `income-tax-${taxYear}-wales`,
      taxYear,
      effectiveDates(effectiveFrom, effectiveTo),
      ["wales"],
      mainRateBands(150_000, basicRateBand),
      sourceId,
      personalAllowance,
    ),
    taxRule(
      `income-tax-${taxYear}-scotland`,
      taxYear,
      effectiveDates(effectiveFrom, effectiveTo),
      ["scotland"],
      scottishBands,
      sourceId,
      personalAllowance,
    ),
  ];
});

const historicalNationalInsuranceRules: RuleDataset["nationalInsurance"] = [
  ["2015-16", 112, 486, 155, 672, 815, 3_532],
  ["2016-17", 112, 486, 155, 672, 827, 3_583],
  ["2017-18", 113, 490, 157, 680, 866, 3_750],
  ["2018-19", 116, 503, 162, 702, 892, 3_863],
  ["2019-20", 118, 512, 166, 719, 962, 4_167],
  ["2020-21", 120, 520, 183, 792, 962, 4_167],
  ["2021-22", 120, 520, 184, 797, 967, 4_189],
].map(
  ([taxYearValue, lelWeekly, lelMonthly, ptWeekly, ptMonthly, uelWeekly, uelMonthly]) => {
    const taxYear = String(taxYearValue);
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    return niRule({
      id: `ni-${taxYear}`,
      taxYear,
      effectiveFrom: `${startYear}-04-06`,
      effectiveTo: `${startYear + 1}-04-05`,
      sourceId: `hmrc-employer-${taxYear}`,
      lowerEarningsLimit: {
        weekly: Number(lelWeekly),
        monthly: Number(lelMonthly),
      },
      primaryThreshold: {
        weekly: Number(ptWeekly),
        monthly: Number(ptMonthly),
      },
      upperEarningsLimit: {
        weekly: Number(uelWeekly),
        monthly: Number(uelMonthly),
      },
      mainRate: 1_200,
      upperRate: 200,
    });
  },
);

const taper = (
  thresholdIncomeLimit: number,
  adjustedIncomeLimit: number,
  minimumAllowance: number,
): TaperedAnnualAllowance => ({
  thresholdIncomeLimit,
  adjustedIncomeLimit,
  minimumAllowance,
});

const historicalPensionRules: RuleDataset["pensions"] = [
  pensionRule(
    "pension-2015-16-pre-alignment",
    "2015-16",
    effectiveDates("2015-04-06", "2015-07-08"),
    80_000,
    ["Pre-alignment allowance; the 2015/16 transitional rules also cap post-alignment carry-forward."],
    null,
    20_000,
  ),
  pensionRule(
    "pension-2015-16-post-alignment",
    "2015-16",
    effectiveDates("2015-07-09", "2016-04-05"),
    0,
    ["Post-alignment allowance before up to £40,000 of unused pre-alignment allowance and other eligible carry-forward."],
    null,
    0,
  ),
  pensionRule(
    "pension-2016-17",
    "2016-17",
    effectiveDates("2016-04-06", "2017-04-05"),
    40_000,
    ["Standard annual allowance before eligible carry-forward."],
    taper(110_000, 150_000, 10_000),
    10_000,
  ),
  ...["2017-18", "2018-19", "2019-20"].map((taxYear) => {
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    return pensionRule(
      `pension-${taxYear}`,
      taxYear,
      effectiveDates(`${startYear}-04-06`, `${startYear + 1}-04-05`),
      40_000,
      ["Standard annual allowance before eligible carry-forward."],
      taper(110_000, 150_000, 10_000),
      4_000,
    );
  }),
  ...["2020-21", "2021-22"].map((taxYear) => {
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    return pensionRule(
      `pension-${taxYear}`,
      taxYear,
      effectiveDates(`${startYear}-04-06`, `${startYear + 1}-04-05`),
      40_000,
      ["Standard annual allowance before eligible carry-forward."],
      taper(200_000, 240_000, 4_000),
      4_000,
    );
  }),
];

export const ruleDataset = {
  datasetVersion: "2026.10.3",
  releasedAt: "2026-10-05",
  supersedes: "2026.10.2",
  corrections: [],
  dataLicence,
  sources: [
    hmrcSource({
      id: "hmrc-income-tax-current-and-past",
      title: "Income Tax rates and allowances for current and previous tax years",
      url: "https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past",
      archiveUrl: null,
      publicationDate: "2014-02-01",
      coverageFrom: "2015-04-06",
      coverageTo: "2027-04-05",
      sourceContentSha256:
        "89b4d254fc3303af663cd405c1f5a880400e4890364fd774e851557c4fa67263",
      snapshotPath: "source-snapshots/income-tax-current-and-past.md",
    }),
    hmrcSource({
      id: "hmrc-employer-2015-16",
      title: "Tax and tax credit rates and thresholds for 2015-16",
      url: "https://www.gov.uk/government/publications/tax-and-tax-credit-rates-and-thresholds-for-2015-16/tax-and-tax-credit-rates-and-thresholds-for-2015-16",
      archiveUrl: null,
      publicationDate: "2014-12-03",
      retrievalDate: "2026-10-05",
      coverageFrom: "2015-04-06",
      coverageTo: "2016-04-05",
      sourceContentSha256:
        "088ccfbf90602d68ca11443036419e9e25a805f62c68ede833b55b6bf74972e0",
      snapshotPath: "source-snapshots/employer-2015-16.md",
      publisher: "HM Treasury",
    }),
    ...[
      ["2016-17", "2016-02-04", "2016-04-06", "2017-04-05", "023073dc371420dd4126be24c1df76a288bc0bfb3b753452bfcb2a1df1e7153f"],
      ["2017-18", "2017-02-09", "2017-04-06", "2018-04-05", "0e07cb69272bba06fddcb45b326e7485b7439b4b181d9c117d05d70a4d9faeb3"],
      ["2018-19", "2018-01-04", "2018-04-06", "2019-04-05", "bbef86a5650a570ab9bd8fd0b544f6e4631c8f1ac253f6549e30a18b6af872b3"],
      ["2019-20", "2019-01-11", "2019-04-06", "2020-04-05", "1765965881cd2b8205450e339b462d7165efcff2f9cc5557197fa507b158c045"],
      ["2020-21", "2020-02-25", "2020-04-06", "2021-04-05", "cf2b23c3a8defb45db369914ac890237203d58e3c2b3510bd5b5cea54b21b599"],
      ["2021-22", "2021-02-02", "2021-04-06", "2022-04-05", "076719d2a5749b84c4298ee075dbd7e49b6d7330712bf4d16f4b5c6c064b0bf3"],
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
      retrievalDate: year && year < "2022-23" ? "2026-10-05" : "2026-10-01",
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
      coverageFrom: "2015-04-06",
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
      coverageFrom: "2015-04-06",
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
      coverageFrom: "2015-04-06",
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
      coverageFrom: "2015-04-06",
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
    ...historicalIncomeTaxRules,
    taxRule(
      "income-tax-2022-23-england-northern-ireland",
      "2022-23",
      effectiveDates("2022-04-06", "2023-04-05"),
      ["england-and-northern-ireland"],
      mainRateBands(150_000),
      "hmrc-employer-2022-23",
    ),
    taxRule(
      "income-tax-2022-23-wales",
      "2022-23",
      effectiveDates("2022-04-06", "2023-04-05"),
      ["wales"],
      mainRateBands(150_000),
      "hmrc-employer-2022-23",
    ),
    taxRule(
      "income-tax-2022-23-scotland",
      "2022-23",
      effectiveDates("2022-04-06", "2023-04-05"),
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
      effectiveDates("2023-04-06", "2024-04-05"),
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2023-24",
    ),
    taxRule(
      "income-tax-2023-24-wales",
      "2023-24",
      effectiveDates("2023-04-06", "2024-04-05"),
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2023-24",
    ),
    taxRule(
      "income-tax-2023-24-scotland",
      "2023-24",
      effectiveDates("2023-04-06", "2024-04-05"),
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
      effectiveDates("2024-04-06", "2025-04-05"),
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2024-25-wales",
      "2024-25",
      effectiveDates("2024-04-06", "2025-04-05"),
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2024-25-scotland",
      "2024-25",
      effectiveDates("2024-04-06", "2025-04-05"),
      ["scotland"],
      scottishBandsFrom2024(2_306, 11_685, 17_101),
      "hmrc-employer-2024-25",
    ),
    taxRule(
      "income-tax-2025-26-england-northern-ireland",
      "2025-26",
      effectiveDates("2025-04-06", "2026-04-05"),
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2025-26-wales",
      "2025-26",
      effectiveDates("2025-04-06", "2026-04-05"),
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2025-26-scotland",
      "2025-26",
      effectiveDates("2025-04-06", "2026-04-05"),
      ["scotland"],
      scottishBandsFrom2024(2_827, 12_094, 16_171),
      "hmrc-employer-2025-26",
    ),
    taxRule(
      "income-tax-2026-27-england-northern-ireland",
      "2026-27",
      effectiveDates("2026-04-06", "2027-04-05"),
      ["england-and-northern-ireland"],
      mainRateBands(125_140),
      "hmrc-employer-2026-27",
    ),
    taxRule(
      "income-tax-2026-27-wales",
      "2026-27",
      effectiveDates("2026-04-06", "2027-04-05"),
      ["wales"],
      mainRateBands(125_140),
      "hmrc-employer-2026-27",
    ),
    taxRule(
      "income-tax-2026-27-scotland",
      "2026-27",
      effectiveDates("2026-04-06", "2027-04-05"),
      ["scotland"],
      scottishBandsFrom2024(3_967, 12_989, 14_136),
      "hmrc-employer-2026-27",
    ),
  ],
  nationalInsurance: [
    ...historicalNationalInsuranceRules,
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
    ...historicalPensionRules,
    pensionRule(
      "pension-2022-23",
      "2022-23",
      effectiveDates("2022-04-06", "2023-04-05"),
      40_000,
      ["Standard annual allowance before eligible carry-forward."],
      taper(200_000, 240_000, 4_000),
      4_000,
    ),
    ...["2023-24", "2024-25", "2025-26", "2026-27"].map((taxYear) => {
      const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
      return pensionRule(
        `pension-${taxYear}`,
        taxYear,
        effectiveDates(`${startYear}-04-06`, `${startYear + 1}-04-05`),
        60_000,
        ["Standard annual allowance before eligible carry-forward."],
        taper(200_000, 260_000, 10_000),
        10_000,
      );
    }),
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
