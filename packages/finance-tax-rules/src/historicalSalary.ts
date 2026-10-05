import {
  calculateIncomeTax,
  type Country,
  type TaxYear,
} from "@saving-tool/hmrc-income-tax";
import { z } from "zod";
import { ruleDataset } from "./data";
import {
  isoDateSchema,
  jurisdictionSchema,
  moneyPenceSchema,
  pensionContributionMethodSchema,
  taxYearSchema,
} from "./schema";

const assumptionSchema = z.object({
  id: z.string().trim().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const pensionSchema = z.object({
  method: pensionContributionMethodSchema,
  employeeGrossContributionPence: moneyPenceSchema,
  employeeCashDeductionPence: moneyPenceSchema,
  salarySacrificePence: moneyPenceSchema,
  employerContributionPence: moneyPenceSchema,
  providerTaxReliefPence: moneyPenceSchema,
});

export const historicalSalaryRequestSchema = z
  .object({
    effectiveDate: isoDateSchema,
    taxYear: taxYearSchema,
    jurisdiction: jurisdictionSchema,
    contractualGrossPayPence: moneyPenceSchema,
    otherTaxableIncomePence: moneyPenceSchema,
    otherDeductionsPence: moneyPenceSchema,
    nationalInsuranceCategory: z.literal("A"),
    isCompanyDirector: z.literal(false),
    pension: pensionSchema.nullable(),
    assumptions: z.array(assumptionSchema),
  })
  .superRefine(({ effectiveDate, taxYear }, context) => {
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    const endYear = startYear + 1;
    if (
      taxYear.slice(5) !== String(endYear % 100).padStart(2, "0") ||
      effectiveDate < `${startYear}-04-06` ||
      effectiveDate > `${endYear}-04-05`
    ) {
      context.addIssue({
        code: "custom",
        message: "Effective date must fall within the stated UK tax year.",
        path: ["effectiveDate"],
      });
    }
  });

const calculationComponentsSchema = z.object({
  contractualGrossPayPence: moneyPenceSchema,
  grossCashPayPence: moneyPenceSchema,
  taxablePayPence: moneyPenceSchema,
  incomeTaxPence: moneyPenceSchema,
  employeeNationalInsurancePence: moneyPenceSchema,
  employeePensionContributionPence: moneyPenceSchema,
  salarySacrificePence: moneyPenceSchema,
  memberPensionDeductionPence: moneyPenceSchema,
  employerPensionContributionPence: moneyPenceSchema,
  providerTaxReliefPence: moneyPenceSchema,
  otherDeductionsPence: moneyPenceSchema,
  takeHomePayPence: moneyPenceSchema,
});

const ruleLineageSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(["income-tax", "class-1-national-insurance", "pension"]),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema,
  sourceIds: z.array(z.string().min(1)).min(1),
});

const sourceLineageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  publicationDate: isoDateSchema,
});

const availableResultSchema = z.object({
  available: z.literal(true),
  precision: z.literal("annual-liability-estimate"),
  inputs: historicalSalaryRequestSchema,
  components: calculationComponentsSchema,
  notes: z.array(z.string().min(1)),
  lineage: z.object({
    calculationVersion: z.literal("historical-salary-v1"),
    engineId: z.literal("saving-tool-annual-with-reviewed-ni-v1"),
    engineVersion: z.literal("3.0.1"),
    ruleDatasetVersion: z.string().min(1),
    taxYear: taxYearSchema,
    jurisdiction: jurisdictionSchema,
    effectiveDate: isoDateSchema,
    rules: z.array(ruleLineageSchema).length(3),
    sources: z.array(sourceLineageSchema).min(1),
    assumptions: z.array(assumptionSchema),
    rounding: z.array(z.string().min(1)).min(1),
  }),
});

const unavailableResultSchema = z.object({
  available: z.literal(false),
  reasons: z.array(
    z.object({
      code: z.string().min(1),
      detail: z.string().min(1),
    }),
  ).min(1),
});

export const historicalSalaryResultSchema = z.discriminatedUnion("available", [
  availableResultSchema,
  unavailableResultSchema,
]);

export type HistoricalSalaryRequest = z.infer<
  typeof historicalSalaryRequestSchema
>;
export type HistoricalSalaryResult = z.infer<
  typeof historicalSalaryResultSchema
>;

type IncomeTaxRule = (typeof ruleDataset.incomeTax)[number];
type NationalInsuranceRule = (typeof ruleDataset.nationalInsurance)[number];
type PensionRule = (typeof ruleDataset.pensions)[number];

const roundTax = (amountPence: number, basisPoints: number) =>
  Math.round((amountPence * basisPoints) / 10_000);

function personalAllowance(
  adjustedNetIncomePence: number,
  rule: IncomeTaxRule,
): number {
  const excess = Math.max(
    0,
    adjustedNetIncomePence -
      rule.personalAllowanceTaper.adjustedNetIncomeStartsAtPence,
  );
  const reduction =
    Math.ceil(
      excess / rule.personalAllowanceTaper.perExcessIncomePence,
    ) * rule.personalAllowanceTaper.allowanceReductionPence;
  return Math.max(0, rule.standardPersonalAllowancePence - reduction);
}

function taxAcrossBands(
  taxablePence: number,
  rule: IncomeTaxRule,
  bandExtensionPence: number,
): number {
  let remaining = taxablePence;
  let tax = 0;
  for (const [index, band] of rule.bands.entries()) {
    const bandExtension = index === 0 ? bandExtensionPence : 0;
    const width =
      band.widthPence == null
        ? Number.POSITIVE_INFINITY
        : band.widthPence + bandExtension;
    const inBand = Math.min(remaining, width);
    tax += roundTax(inBand, band.rateBasisPoints);
    remaining -= inBand;
    if (remaining <= 0) break;
  }
  return tax;
}

function savingToolTax(
  incomePence: number,
  allowancePence: number,
  taxYear: string,
  jurisdiction: HistoricalSalaryRequest["jurisdiction"],
): number | null {
  const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
  const country: Country =
    jurisdiction === "scotland" ? "Scotland" : "England/NI/Wales";
  if (
    startYear < 2022 ||
    country === "Scotland" &&
    (taxYear === "2022-23" || taxYear === "2023-24")
  ) {
    return null;
  }
  const result = calculateIncomeTax({
    taxYear: taxYear.replace("-", "/") as TaxYear,
    country,
    taxableAnnualIncome: incomePence / 100,
    personalAllowance: allowancePence / 100,
  });
  return Math.round(result.total * 100);
}

function incomeTaxFor(
  incomePence: number,
  allowancePence: number,
  rule: IncomeTaxRule,
  jurisdiction: HistoricalSalaryRequest["jurisdiction"],
): number {
  const taxablePence = Math.max(0, incomePence - allowancePence);
  const libraryResult = savingToolTax(
    incomePence,
    allowancePence,
    rule.taxYear,
    jurisdiction,
  );
  return libraryResult ?? taxAcrossBands(taxablePence, rule, 0);
}

function annualNationalInsurance(
  annualPayPence: number,
  rule: NationalInsuranceRule,
): number {
  const monthlyPay = annualPayPence / 12;
  const primary = rule.thresholds.primaryThresholdPence.monthly;
  const upper = rule.thresholds.upperEarningsLimitPence.monthly;
  const main = Math.max(0, Math.min(monthlyPay, upper) - primary);
  const above = Math.max(0, monthlyPay - upper);
  return (
    roundTax(main, rule.rates.primaryToUpperBasisPoints) * 12 +
    roundTax(above, rule.rates.aboveUpperBasisPoints) * 12
  );
}

function selectedRules(request: HistoricalSalaryRequest): {
  incomeTax: IncomeTaxRule;
  nationalInsurance: NationalInsuranceRule;
  pension: PensionRule;
} | null {
  const containsDate = (rule: { effectiveFrom: string; effectiveTo: string }) =>
    rule.effectiveFrom <= request.effectiveDate &&
    request.effectiveDate <= rule.effectiveTo;
  const incomeTax = ruleDataset.incomeTax.find(
    (rule) =>
      rule.legalStatus === "enacted" &&
      rule.jurisdictions.includes(request.jurisdiction) &&
      containsDate(rule),
  );
  const nationalInsurance = ruleDataset.nationalInsurance.find(
    (rule) => rule.legalStatus === "enacted" && containsDate(rule),
  );
  const pension = ruleDataset.pensions.find(
    (rule) =>
      rule.legalStatus === "enacted" &&
      rule.jurisdictions.includes(request.jurisdiction) &&
      containsDate(rule),
  );
  return incomeTax && nationalInsurance && pension
    ? { incomeTax, nationalInsurance, pension }
    : null;
}

function ruleLineage(
  rule: IncomeTaxRule | NationalInsuranceRule | PensionRule,
) {
  return {
    id: rule.id,
    version: rule.version,
    kind: rule.kind,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    sourceIds: rule.provenance.sourceIds,
  };
}

export function calculateHistoricalSalary(
  input: HistoricalSalaryRequest,
): HistoricalSalaryResult {
  const request = historicalSalaryRequestSchema.parse(input);
  const rules = selectedRules(request);
  if (rules == null) {
    return {
      available: false,
      reasons: [
        {
          code: "unsupported-rules",
          detail: `${request.effectiveDate} and ${request.jurisdiction} do not have a complete reviewed rule set.`,
        },
      ],
    };
  }

  const pension = request.pension;
  const salarySacrifice =
    pension?.method === "salary-sacrifice"
      ? pension.salarySacrificePence
      : 0;
  const netPay =
    pension?.method === "net-pay"
      ? pension.employeeGrossContributionPence
      : 0;
  const reliefAtSource =
    pension?.method === "relief-at-source"
      ? pension.employeeGrossContributionPence
      : 0;
  const grossCashPayPence = Math.max(
    0,
    request.contractualGrossPayPence - salarySacrifice,
  );
  const salaryIncomePence = Math.max(0, grossCashPayPence - netPay);
  const totalIncomePence =
    salaryIncomePence + request.otherTaxableIncomePence;
  const allowancePence = personalAllowance(
    Math.max(0, totalIncomePence - reliefAtSource),
    rules.incomeTax,
  );
  const taxableTotalPence = Math.max(0, totalIncomePence - allowancePence);
  const taxableOtherPence = Math.max(
    0,
    request.otherTaxableIncomePence - allowancePence,
  );
  const taxablePayPence = taxableTotalPence - taxableOtherPence;
  const incomeTaxPence = Math.max(
    0,
    incomeTaxFor(
      totalIncomePence,
      allowancePence,
      rules.incomeTax,
      request.jurisdiction,
    ) -
      incomeTaxFor(
        request.otherTaxableIncomePence,
        allowancePence,
        rules.incomeTax,
        request.jurisdiction,
      ),
  );
  const employeeNationalInsurancePence = annualNationalInsurance(
    grossCashPayPence,
    rules.nationalInsurance,
  );
  const memberPensionDeductionPence =
    pension?.employeeCashDeductionPence ?? 0;
  const takeHomePayPence = Math.max(
    0,
    grossCashPayPence -
      incomeTaxPence -
      employeeNationalInsurancePence -
      memberPensionDeductionPence -
      request.otherDeductionsPence,
  );
  const selected = [rules.incomeTax, rules.nationalInsurance, rules.pension];
  const sourceIds = new Set(
    selected.flatMap(({ provenance }) => provenance.sourceIds),
  );
  const sources = ruleDataset.sources
    .filter(({ id }) => sourceIds.has(id))
    .map(({ id, title, publisher, url, publicationDate }) => ({
      id,
      title,
      publisher,
      url,
      publicationDate,
    }));

  return historicalSalaryResultSchema.parse({
    available: true,
    precision: "annual-liability-estimate",
    inputs: request,
    components: {
      contractualGrossPayPence: request.contractualGrossPayPence,
      grossCashPayPence,
      taxablePayPence,
      incomeTaxPence,
      employeeNationalInsurancePence,
      employeePensionContributionPence:
        pension?.employeeGrossContributionPence ?? 0,
      salarySacrificePence: pension?.salarySacrificePence ?? 0,
      memberPensionDeductionPence,
      employerPensionContributionPence:
        pension?.employerContributionPence ?? 0,
      providerTaxReliefPence: pension?.providerTaxReliefPence ?? 0,
      otherDeductionsPence: request.otherDeductionsPence,
      takeHomePayPence,
    },
    notes: [
      "Income Tax is an annual liability estimate, not a PAYE withholding calculation.",
      "Employee National Insurance is annualised from twelve monthly threshold periods at the rate effective on the calculation date.",
    ],
    lineage: {
      calculationVersion: "historical-salary-v1",
      engineId: "saving-tool-annual-with-reviewed-ni-v1",
      engineVersion: "3.0.1",
      ruleDatasetVersion: ruleDataset.datasetVersion,
      taxYear: request.taxYear,
      jurisdiction: request.jurisdiction,
      effectiveDate: request.effectiveDate,
      rules: selected.map(ruleLineage),
      sources,
      assumptions: request.assumptions,
      rounding: [
        "Income Tax is rounded to the nearest penny after calculating the annual liability.",
        "Employee National Insurance is rounded to the nearest penny for each representative monthly period, then multiplied by twelve.",
        "Pension and other deductions preserve the supplied penny amounts.",
      ],
    },
  });
}
