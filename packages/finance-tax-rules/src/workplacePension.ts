import { z } from "zod";
import { ruleDataset } from "./data";
import {
  isoDateSchema,
  moneyPenceSchema,
  pensionContributionMethodSchema,
  pensionPayPeriodSchema,
  rateBasisPointsSchema,
} from "./schema";

export const workplacePensionContributionBasisSchema = z.enum([
  "gross-pay",
  "qualifying-earnings",
  "pensionable-pay",
]);

export const workplacePensionEmployeeContributionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("unknown") }),
    z.object({
      kind: z.literal("explicit-amount"),
      taxTreatment: pensionContributionMethodSchema,
      grossAmountPence: moneyPenceSchema,
    }),
    z.object({
      kind: z.literal("percentage"),
      taxTreatment: pensionContributionMethodSchema,
      basis: workplacePensionContributionBasisSchema,
      rateBasisPoints: rateBasisPointsSchema,
    }),
  ],
);

const employerPolicyLimitsSchema = z.object({
  schemeMinimumRateBasisPoints: rateBasisPointsSchema.default(0),
  maximumRateBasisPoints: rateBasisPointsSchema.optional(),
  maximumAmountPence: moneyPenceSchema.optional(),
});

export const workplacePensionEmployerPolicySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("unknown") }),
    z.object({
      kind: z.literal("explicit-amount"),
      amountPence: moneyPenceSchema,
    }),
    z.object({
      kind: z.literal("flat-rate"),
      basis: workplacePensionContributionBasisSchema,
      rateBasisPoints: rateBasisPointsSchema,
      ...employerPolicyLimitsSchema.shape,
    }),
    z
      .object({
        kind: z.literal("matching"),
        basis: workplacePensionContributionBasisSchema,
        tiers: z
          .array(
            z.object({
              employeeRateUpToBasisPoints: rateBasisPointsSchema,
              matchRatioBasisPoints: z.number().int().min(0).max(100_000),
            }),
          )
          .min(1),
        ...employerPolicyLimitsSchema.shape,
      })
      .superRefine(({ tiers }, context) => {
        for (let index = 1; index < tiers.length; index += 1) {
          if (
            (tiers[index]?.employeeRateUpToBasisPoints ?? 0) <=
            (tiers[index - 1]?.employeeRateUpToBasisPoints ?? 0)
          ) {
            context.addIssue({
              code: "custom",
              path: ["tiers", index, "employeeRateUpToBasisPoints"],
              message: "Matching tier limits must increase",
            });
          }
        }
      }),
  ],
);

export const workplacePensionRequestSchema = z
  .object({
    effectiveDate: isoDateSchema,
    payPeriod: pensionPayPeriodSchema,
    annualGrossPayPence: moneyPenceSchema,
    annualQualifyingEarningsPayPence: moneyPenceSchema.optional(),
    qualifyingEarningsVariablePaymentsPence: z
      .array(moneyPenceSchema)
      .default([]),
    annualPensionablePayPence: moneyPenceSchema.optional(),
    employee: workplacePensionEmployeeContributionSchema,
    employer: workplacePensionEmployerPolicySchema,
  })
  .superRefine((request, context) => {
    const variableTotal = request.qualifyingEarningsVariablePaymentsPence.reduce(
      (total, amount) => total + amount,
      0,
    );
    if (
      request.annualQualifyingEarningsPayPence != null &&
      variableTotal > request.annualQualifyingEarningsPayPence
    ) {
      context.addIssue({
        code: "custom",
        path: ["qualifyingEarningsVariablePaymentsPence"],
        message:
          "Variable qualifying earnings cannot exceed total qualifying earnings",
      });
    }
  });

export type WorkplacePensionContributionBasis = z.infer<
  typeof workplacePensionContributionBasisSchema
>;
export type WorkplacePensionEmployeeContribution = z.infer<
  typeof workplacePensionEmployeeContributionSchema
>;
export type WorkplacePensionEmployerPolicy = z.infer<
  typeof workplacePensionEmployerPolicySchema
>;
export type WorkplacePensionRequest = z.input<
  typeof workplacePensionRequestSchema
>;

type CalculationReason = { code: string; detail: string };

export type WorkplacePensionResult =
  | {
      available: true;
      employeeGrossContributionPence: number;
      employeeCashDeductionPence: number;
      salarySacrificePence: number;
      employerContributionPence: number;
      providerTaxReliefPence: number;
      bases: {
        grossPayPence: number;
        qualifyingEarningsPence: number | null;
        pensionablePayPence: number | null;
      };
      lineage: {
        datasetVersion: string;
        pensionRuleId: string;
        pensionRuleVersion: string;
        effectiveDate: string;
        payPeriod: z.infer<typeof pensionPayPeriodSchema>;
        sourceIds: string[];
      };
    }
  | { available: false; reasons: CalculationReason[] };

const periodsPerYear = {
  weekly: 52,
  fortnightly: 26,
  "four-weekly": 13,
  monthly: 12,
  quarterly: 4,
  "half-yearly": 2,
  annual: 1,
} as const;

function selectedPensionRule(effectiveDate: string) {
  return ruleDataset.pensions.find(
    (rule) =>
      rule.legalStatus === "enacted" &&
      rule.effectiveFrom <= effectiveDate &&
      effectiveDate <= rule.effectiveTo,
  );
}

function distributedPeriods(total: number, periods: number): number[] {
  const base = Math.floor(total / periods);
  const remainder = total - base * periods;
  return Array.from(
    { length: periods },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function qualifyingEarningsBasis(
  request: z.output<typeof workplacePensionRequestSchema>,
  rule: (typeof ruleDataset.pensions)[number],
): number | null {
  const total = request.annualQualifyingEarningsPayPence;
  if (total == null) return null;
  const periods = periodsPerYear[request.payPeriod];
  const variables = request.qualifyingEarningsVariablePaymentsPence;
  const variableTotal = variables.reduce((sum, amount) => sum + amount, 0);
  const pay = distributedPeriods(total - variableTotal, periods);
  for (const [index, amount] of variables.entries()) {
    pay[index % periods] = (pay[index % periods] ?? 0) + amount;
  }
  const band = rule.qualifyingEarnings.bands[request.payPeriod];
  return pay.reduce(
    (sum, amount) =>
      sum + Math.max(0, Math.min(amount, band.upperPence) - band.lowerPence),
    0,
  );
}

function basisAmount(
  basis: WorkplacePensionContributionBasis,
  request: z.output<typeof workplacePensionRequestSchema>,
  qualifyingEarningsPence: number | null,
): number | null {
  if (basis === "gross-pay") return request.annualGrossPayPence;
  if (basis === "qualifying-earnings") return qualifyingEarningsPence;
  return request.annualPensionablePayPence ?? null;
}

function percentage(amount: number, rateBasisPoints: number): number {
  return Math.round((amount * rateBasisPoints) / 10_000);
}

function cappedEmployerContribution(
  basisPence: number,
  rateBasisPoints: number,
  policy: Extract<
    WorkplacePensionEmployerPolicy,
    { kind: "flat-rate" | "matching" }
  >,
): number {
  const minimumRate = policy.schemeMinimumRateBasisPoints;
  const maximumRate = policy.maximumRateBasisPoints ?? 10_000;
  const boundedRate = Math.min(
    maximumRate,
    Math.max(minimumRate, rateBasisPoints),
  );
  const byRate = percentage(basisPence, boundedRate);
  return Math.min(byRate, policy.maximumAmountPence ?? byRate);
}

function matchingRate(
  employeeRateBasisPoints: number,
  policy: Extract<WorkplacePensionEmployerPolicy, { kind: "matching" }>,
): number {
  let lower = 0;
  let employerRate = 0;
  for (const tier of policy.tiers) {
    const matchedEmployeeRate = Math.max(
      0,
      Math.min(employeeRateBasisPoints, tier.employeeRateUpToBasisPoints) -
        lower,
    );
    employerRate += Math.round(
      (matchedEmployeeRate * tier.matchRatioBasisPoints) / 10_000,
    );
    lower = tier.employeeRateUpToBasisPoints;
    if (employeeRateBasisPoints <= lower) break;
  }
  return employerRate;
}

type ParsedWorkplacePensionRequest = z.output<
  typeof workplacePensionRequestSchema
>;
type PensionRule = (typeof ruleDataset.pensions)[number];

function calculationReasons(
  request: ParsedWorkplacePensionRequest,
  qualifyingEarningsPence: number | null,
): CalculationReason[] {
  const reasons: CalculationReason[] = [];
  if (request.employee.kind === "unknown") {
    reasons.push({
      code: "unknown-employee-contribution",
      detail:
        "The employee contribution rule is unknown. Supply the scheme rule or an explicit amount override.",
    });
  }
  if (request.employer.kind === "unknown") {
    reasons.push({
      code: "unknown-employer-policy",
      detail:
        "The employer contribution rule is unknown. Supply the scheme policy or an explicit amount override.",
    });
  }
  const requiredBases = [
    request.employee.kind === "percentage" ? request.employee.basis : null,
    request.employer.kind === "flat-rate" || request.employer.kind === "matching"
      ? request.employer.basis
      : null,
  ];
  if (
    requiredBases.includes("qualifying-earnings") &&
    qualifyingEarningsPence == null
  ) {
    reasons.push({
      code: "missing-qualifying-earnings-pay",
      detail:
        "Qualifying-earnings contributions need the pay components covered by the statutory band.",
    });
  }
  if (
    requiredBases.includes("pensionable-pay") &&
    request.annualPensionablePayPence == null
  ) {
    reasons.push({
      code: "missing-pensionable-pay",
      detail:
        "Pensionable-pay contributions need the scheme's explicit pensionable pay amount.",
    });
  }
  return reasons;
}

function employeeGrossContribution(
  request: ParsedWorkplacePensionRequest,
  qualifyingEarningsPence: number | null,
): number {
  if (request.employee.kind === "explicit-amount") {
    return request.employee.grossAmountPence;
  }
  if (request.employee.kind !== "percentage") return 0;
  const basis =
    basisAmount(request.employee.basis, request, qualifyingEarningsPence) ?? 0;
  return percentage(basis, request.employee.rateBasisPoints);
}

function employeeTaxTreatment(
  employee: WorkplacePensionEmployeeContribution,
) {
  return employee.kind === "explicit-amount" || employee.kind === "percentage"
    ? employee.taxTreatment
    : null;
}

function employeeAmounts(
  request: ParsedWorkplacePensionRequest,
  qualifyingEarningsPence: number | null,
  rule: PensionRule,
) {
  const gross = employeeGrossContribution(request, qualifyingEarningsPence);
  const taxTreatment = employeeTaxTreatment(request.employee);
  const method = rule.methods.find(
    (candidate) => candidate.method === taxTreatment,
  );
  const providerRelief =
    method == null ? 0 : percentage(gross, method.providerReliefBasisPoints);
  return {
    gross,
    cashDeduction:
      taxTreatment === "salary-sacrifice" ? 0 : gross - providerRelief,
    salarySacrifice: taxTreatment === "salary-sacrifice" ? gross : 0,
    providerRelief,
  };
}

function matchingEmployeeRate(
  employee: WorkplacePensionEmployeeContribution,
  employeeGrossContributionPence: number,
  employerBasisPence: number,
): number {
  if (employee.kind === "percentage") return employee.rateBasisPoints;
  if (employerBasisPence === 0) return 0;
  return Math.round(
    (employeeGrossContributionPence * 10_000) / employerBasisPence,
  );
}

function employerContribution(
  request: ParsedWorkplacePensionRequest,
  qualifyingEarningsPence: number | null,
  employeeGrossContributionPence: number,
): number {
  const policy = request.employer;
  if (policy.kind === "explicit-amount") return policy.amountPence;
  if (policy.kind !== "flat-rate" && policy.kind !== "matching") return 0;
  const employerBasis =
    basisAmount(policy.basis, request, qualifyingEarningsPence) ?? 0;
  const rate =
    policy.kind === "flat-rate"
      ? policy.rateBasisPoints
      : matchingRate(
          matchingEmployeeRate(
            request.employee,
            employeeGrossContributionPence,
            employerBasis,
          ),
          policy,
        );
  return cappedEmployerContribution(employerBasis, rate, policy);
}

export function calculateWorkplacePension(
  input: WorkplacePensionRequest,
): WorkplacePensionResult {
  const request = workplacePensionRequestSchema.parse(input);
  const rule = selectedPensionRule(request.effectiveDate);
  if (rule == null) {
    return {
      available: false,
      reasons: [
        {
          code: "unsupported-pension-rule-date",
          detail: `${request.effectiveDate} has no reviewed workplace pension rule.`,
        },
      ],
    };
  }
  const qualifyingEarningsPence = qualifyingEarningsBasis(request, rule);
  const reasons = calculationReasons(request, qualifyingEarningsPence);
  if (reasons.length > 0) return { available: false, reasons };

  const employee = employeeAmounts(request, qualifyingEarningsPence, rule);
  const employerContributionPence = employerContribution(
    request,
    qualifyingEarningsPence,
    employee.gross,
  );

  return {
    available: true,
    employeeGrossContributionPence: employee.gross,
    employeeCashDeductionPence: employee.cashDeduction,
    salarySacrificePence: employee.salarySacrifice,
    employerContributionPence,
    providerTaxReliefPence: employee.providerRelief,
    bases: {
      grossPayPence: request.annualGrossPayPence,
      qualifyingEarningsPence,
      pensionablePayPence: request.annualPensionablePayPence ?? null,
    },
    lineage: {
      datasetVersion: ruleDataset.datasetVersion,
      pensionRuleId: rule.id,
      pensionRuleVersion: rule.version,
      effectiveDate: request.effectiveDate,
      payPeriod: request.payPeriod,
      sourceIds: rule.provenance.sourceIds,
    },
  };
}
