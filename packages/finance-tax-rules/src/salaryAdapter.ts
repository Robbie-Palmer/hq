import { z } from "zod";
import {
  isoDateSchema,
  jurisdictionSchema,
  moneyPenceSchema,
  pensionContributionMethodSchema,
  taxYearSchema,
} from "./schema";

const versionSchema = z.string().trim().min(1);

export const salaryCalculationPrecisionSchema = z.literal(
  "annual-liability-estimate",
);

export const salaryCalculationAssumptionSchema = z.object({
  id: z.string().trim().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  sourceUrl: z.url().optional(),
});

export const salaryCalculationRequestSchema = z
  .object({
    effectiveDate: isoDateSchema,
    taxYear: taxYearSchema,
    jurisdiction: jurisdictionSchema,
    precision: salaryCalculationPrecisionSchema,
    pay: z.object({
      contractualGrossPayPence: moneyPenceSchema,
      grossCashPayPence: moneyPenceSchema,
      taxablePayPence: moneyPenceSchema,
      nationalInsuranceEarningsPence: moneyPenceSchema,
    }),
    pension: z
      .object({
        method: pensionContributionMethodSchema,
        grossContributionPence: moneyPenceSchema,
        memberDeductionPence: moneyPenceSchema,
        employerContributionPence: moneyPenceSchema,
        providerTaxReliefPence: moneyPenceSchema,
      })
      .nullable(),
    assumptions: z.array(salaryCalculationAssumptionSchema),
  })
  .superRefine(({ effectiveDate, taxYear }, context) => {
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    const endYear = startYear + 1;
    const expectedSuffix = String(endYear % 100).padStart(2, "0");

    if (taxYear.slice(5) !== expectedSuffix) {
      context.addIssue({
        code: "custom",
        message: "Tax year must name consecutive calendar years.",
        path: ["taxYear"],
      });
      return;
    }

    if (
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

export const salaryCalculationComponentsSchema = z.object({
  grossCashPayPence: moneyPenceSchema,
  taxablePayPence: moneyPenceSchema,
  incomeTaxPence: moneyPenceSchema,
  employeeNationalInsurancePence: moneyPenceSchema,
  memberPensionDeductionPence: moneyPenceSchema,
  employerPensionContributionPence: moneyPenceSchema,
  providerTaxReliefPence: moneyPenceSchema,
  takeHomePayPence: moneyPenceSchema,
});

const salaryCalculationComponentNames = [
  "grossCashPayPence",
  "taxablePayPence",
  "incomeTaxPence",
  "employeeNationalInsurancePence",
  "memberPensionDeductionPence",
  "employerPensionContributionPence",
  "providerTaxReliefPence",
  "takeHomePayPence",
] as const;

const salaryCalculationRoundingSchema = z
  .array(
    z.object({
      component: z.enum(salaryCalculationComponentNames),
      rule: z.string().trim().min(1),
    }),
  )
  .superRefine((rounding, context) => {
    const seen = new Set<string>();

    for (const [index, entry] of rounding.entries()) {
      if (seen.has(entry.component)) {
        context.addIssue({
          code: "custom",
          message: "Rounding components must be unique.",
          path: [index, "component"],
        });
      }
      seen.add(entry.component);
    }

    for (const component of salaryCalculationComponentNames) {
      if (!seen.has(component)) {
        context.addIssue({
          code: "custom",
          message: `Missing rounding lineage for ${component}.`,
        });
      }
    }
  });

export const salaryCalculationLineageSchema = z.object({
  adapterId: z.string().trim().min(1),
  adapterVersion: versionSchema,
  engineId: z.string().trim().min(1),
  engineVersion: versionSchema,
  ruleDatasetVersion: versionSchema,
  effectiveRuleVersion: versionSchema,
  calculationVersion: versionSchema,
  sourceRuleIds: z.array(z.string().trim().min(1)).min(1),
  assumptions: z.array(salaryCalculationAssumptionSchema),
  rounding: salaryCalculationRoundingSchema,
});

export const salaryCalculationResultSchema = z.object({
  precision: salaryCalculationPrecisionSchema,
  components: salaryCalculationComponentsSchema,
  lineage: salaryCalculationLineageSchema,
});

export type SalaryCalculationRequest = z.infer<
  typeof salaryCalculationRequestSchema
>;
export type SalaryCalculationResult = z.infer<
  typeof salaryCalculationResultSchema
>;

export interface SalaryCalculatorAdapter {
  calculate(request: SalaryCalculationRequest): SalaryCalculationResult;
}
