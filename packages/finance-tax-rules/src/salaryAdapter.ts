import { z } from "zod";
import {
  isoDateSchema,
  jurisdictionSchema,
  moneyPenceSchema,
  pensionContributionMethodSchema,
  taxYearSchema,
} from "./schema";

const versionSchema = z.string().trim().min(1);

export const salaryCalculationPrecisionSchema = z.enum([
  "annual-liability-estimate",
  "exact-payroll-deduction",
]);

export const salaryCalculationAssumptionSchema = z.object({
  id: z.string().trim().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  sourceUrl: z.url().optional(),
});

export const salaryCalculationRequestSchema = z.object({
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
  rounding: z
    .array(
      z.object({
        component: salaryCalculationComponentsSchema.keyof(),
        rule: z.string().trim().min(1),
      }),
    )
    .min(1),
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
