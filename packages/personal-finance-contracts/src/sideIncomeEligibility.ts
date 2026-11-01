import { z } from "zod";
import {
  FULL_OWNERSHIP_BASIS_POINTS,
  type FinancialFact,
  IsoDateSchema,
  SIDE_INCOME_CURRENCY,
  SIDE_INCOME_JURISDICTION,
  type SideIncomeCase,
  SideIncomeCaseSchema,
  TaxYearSchema,
} from "./sideIncome";
import {
  findSideIncomeRule,
  type SideIncomeRule,
  UK_SIDE_INCOME_RULESET_VERSION,
  ukSideIncomeRules,
} from "./sideIncomeRules";

export const StructureOptionSchema = z.enum([
  "sole-trader",
  "uk-limited-company",
  "umbrella-employment",
]);
export type StructureOption = z.infer<typeof StructureOptionSchema>;

export const EligibilityStateSchema = z.enum([
  "eligible",
  "ineligible",
  "needs-review",
  "unsupported",
  "requires-arrangement",
]);
export type EligibilityState = z.infer<typeof EligibilityStateSchema>;

export const RuleEvaluationStatusSchema = z.enum([
  "required",
  "not-required",
  "available",
  "not-available",
  "needs-review",
  "informational",
]);

export const EligibilityIssueSchema = z
  .object({
    code: z.enum([
      "cross-border",
      "partnership",
      "overseas-entity",
      "multi-owner",
      "unknown-residence",
      "unknown-business-structure",
      "missing-ownership",
      "missing-activity",
    ]),
    state: z.enum(["unsupported", "needs-review"]),
    detail: z.string().trim().min(1),
  })
  .strict();
export type EligibilityIssue = z.infer<typeof EligibilityIssueSchema>;

export const RuleEvaluationSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    ruleVersion: z.string().trim().min(1),
    status: RuleEvaluationStatusSchema,
    detail: z.string().trim().min(1),
  })
  .strict();
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;

export const StructureEligibilitySchema = z
  .object({
    option: StructureOptionSchema,
    state: EligibilityStateSchema,
    coveredActivityIds: z.array(z.string()),
    uncoveredActivityIds: z.array(z.string()),
    reasons: z.array(z.string().trim().min(1)),
    rules: z.array(RuleEvaluationSchema),
  })
  .strict();
export type StructureEligibility = z.infer<typeof StructureEligibilitySchema>;

export const SideIncomeEligibilityResultSchema = z
  .object({
    rulesetVersion: z.literal(UK_SIDE_INCOME_RULESET_VERSION),
    evaluatedOn: IsoDateSchema,
    taxYear: TaxYearSchema,
    rankingAllowed: z.boolean(),
    issues: z.array(EligibilityIssueSchema),
    options: z.array(StructureEligibilitySchema).length(3),
  })
  .strict();
export type SideIncomeEligibilityResult = z.infer<
  typeof SideIncomeEligibilityResultSchema
>;

const supportedMoney = (fact: FinancialFact) =>
  fact.amount.currency === SIDE_INCOME_CURRENCY &&
  fact.amount.jurisdiction === SIDE_INCOME_JURISDICTION;

const activeOwnerships = (input: SideIncomeCase, on: string) =>
  input.businessOwnerships.filter(
    (ownership) =>
      ownership.effectiveFrom <= on &&
      (ownership.effectiveTo === null || on < ownership.effectiveTo),
  );

const findIssues = (input: SideIncomeCase, evaluatedOn: string): EligibilityIssue[] => {
  const issues: EligibilityIssue[] = [];
  const residences = input.people.map((person) => person.taxResidence);
  if (residences.some((residence) => residence.status === "unknown")) {
    issues.push({
      code: "unknown-residence",
      state: "needs-review",
      detail: "Tax residence is needed before UK structure eligibility can be ranked.",
    });
  }
  if (
    residences.some(
      (residence) =>
        residence.status === "non-resident" ||
        (residence.jurisdiction !== null &&
          residence.jurisdiction !== SIDE_INCOME_JURISDICTION),
    ) ||
    input.businesses.some(
      (business) => business.jurisdiction !== SIDE_INCOME_JURISDICTION,
    ) ||
    input.customerArrangements.some(
      (arrangement) =>
        arrangement.customerJurisdiction !== SIDE_INCOME_JURISDICTION,
    ) ||
    input.financialFacts.some((fact) => !supportedMoney(fact))
  ) {
    issues.push({
      code: "cross-border",
      state: "unsupported",
      detail: "Cross-border residence, entities, customers, or money need specialist review.",
    });
  }
  if (input.businesses.some((business) => business.structure === "partnership")) {
    issues.push({
      code: "partnership",
      state: "unsupported",
      detail: "Partnership income and ownership are outside this single-owner model.",
    });
  }
  if (
    input.businesses.some((business) =>
      ["overseas-company", "foreign-llc"].includes(business.structure),
    )
  ) {
    issues.push({
      code: "overseas-entity",
      state: "unsupported",
      detail: "Overseas companies and foreign LLCs need entity and residence advice.",
    });
  }
  if (input.businesses.some((business) => business.structure === "unknown")) {
    issues.push({
      code: "unknown-business-structure",
      state: "needs-review",
      detail: "The current business structure is unknown.",
    });
  }

  const ownerships = activeOwnerships(input, evaluatedOn);
  const activeActivityOwnerships = input.activityOwnerships.filter(
    (ownership) =>
      ownership.effectiveFrom <= evaluatedOn &&
      (ownership.effectiveTo === null || evaluatedOn < ownership.effectiveTo),
  );
  const missingBusinessOwner = input.businesses.some(
    (business) =>
      !ownerships.some((ownership) => ownership.businessId === business.id),
  );
  const missingActivityOwner = input.activities.some(
    (activity) =>
      !activeActivityOwnerships.some(
        (ownership) => ownership.activityId === activity.id,
      ),
  );
  if (missingBusinessOwner || missingActivityOwner) {
    issues.push({
      code: "missing-ownership",
      state: "needs-review",
      detail: "Each activity and business needs current ownership before structures can be ranked.",
    });
  }
  for (const business of input.businesses) {
    const owners = ownerships.filter((ownership) => ownership.businessId === business.id);
    if (
      owners.length > 1 ||
      (owners.length === 1 &&
        owners[0]?.ownershipBasisPoints !== FULL_OWNERSHIP_BASIS_POINTS)
    ) {
      issues.push({
        code: "multi-owner",
        state: "unsupported",
        detail: `${business.name} does not have one recorded 100% owner.`,
      });
      break;
    }
  }
  if (input.activities.length === 0) {
    issues.push({
      code: "missing-activity",
      state: "needs-review",
      detail: "At least one income activity is needed before eligibility can be assessed.",
    });
  }
  return issues;
};

const evaluation = (
  rule: SideIncomeRule,
  status: RuleEvaluation["status"],
  detail: string,
): RuleEvaluation => ({
  ruleId: rule.id,
  ruleVersion: rule.version,
  status,
  detail,
});

const annualGrossRevenue = (input: SideIncomeCase, taxYear: string) => {
  const facts = input.financialFacts.filter(
    (fact) => fact.kind === "gross-revenue" && fact.taxYear === taxYear,
  );
  if (facts.length === 0 || facts.some((fact) => !supportedMoney(fact))) return null;
  return facts.reduce((sum, fact) => sum + fact.amount.minorUnits, 0);
};

const evaluateSoleTraderRules = (
  input: SideIncomeCase,
  taxYear: string,
  evaluatedOn: string,
): RuleEvaluation[] => {
  const registration = findSideIncomeRule(
    "uk.sole-trader.self-assessment-registration",
  );
  const allowance = findSideIncomeRule("uk.sole-trader.trading-allowance");
  const grossRevenue = annualGrossRevenue(input, taxYear);
  const registrationThreshold = registration.test.kind === "threshold"
    ? registration.test.amount.minorUnits
    : Number.NaN;
  const connectedPartyUnknown = input.customerArrangements.some(
    (arrangement) =>
      arrangement.connectedParty === "unknown" ||
      arrangement.currentEmployerRelated === "unknown",
  );
  const allowanceExcluded = input.customerArrangements.some(
    (arrangement) =>
      arrangement.connectedParty === true ||
      arrangement.currentEmployerRelated === true,
  );

  const output: RuleEvaluation[] = [];
  if (grossRevenue === null) {
    output.push(
      evaluation(
        registration,
        "needs-review",
        `No complete GBP gross-revenue facts were recorded for ${taxYear}.`,
      ),
    );
  } else {
    output.push(
      evaluation(
        registration,
        grossRevenue > registrationThreshold ? "required" : "not-required",
        `Recorded gross trading income is £${(grossRevenue / 100).toFixed(2)} for ${taxYear}.`,
      ),
    );
  }

  if (allowanceExcluded) {
    output.push(
      evaluation(
        allowance,
        "not-available",
        "At least one income source is connected-party or employer-related.",
      ),
    );
  } else if (connectedPartyUnknown || grossRevenue === null) {
    output.push(
      evaluation(
        allowance,
        "needs-review",
        "Trading-allowance exclusions or aggregate gross income are incomplete.",
      ),
    );
  } else {
    output.push(
      evaluation(
        allowance,
        "available",
        grossRevenue <= registrationThreshold
          ? "Full relief may apply; keep income records and check other registration reasons."
          : "Partial relief may apply instead of actual costs; compare both treatments.",
      ),
    );
  }

  output.push(evaluateVat(input), evaluateMtd(input, evaluatedOn));
  return output;
};

const evaluateVat = (input: SideIncomeCase): RuleEvaluation => {
  const rule = findSideIncomeRule("uk.vat.registration");
  const threshold = rule.test.kind === "threshold"
    ? rule.test.amount.minorUnits
    : Number.NaN;
  if (input.vatPositions.length === 0) {
    return evaluation(
      rule,
      "needs-review",
      "No rolling 12-month or next-30-day taxable-turnover position is recorded.",
    );
  }
  if (
    input.vatPositions.every(
      (position) => position.allSuppliesExemptOrOutOfScope === true,
    )
  ) {
    return evaluation(
      rule,
      "not-required",
      "Every recorded VAT position says all supplies are exempt or out of scope.",
    );
  }
  const amounts = input.vatPositions.flatMap((position) =>
    [
      position.trailingTwelveMonthTaxableTurnover,
      position.expectedNextThirtyDayTaxableTurnover,
    ].filter((amount) => amount !== null),
  );
  if (
    amounts.length === 0 ||
    amounts.some(
      (amount) =>
        amount.currency !== SIDE_INCOME_CURRENCY ||
        amount.jurisdiction !== SIDE_INCOME_JURISDICTION,
    ) ||
    input.vatPositions.some(
      (position) => position.allSuppliesExemptOrOutOfScope === "unknown",
    )
  ) {
    return evaluation(rule, "needs-review", "The VAT applicability facts are incomplete.");
  }
  const overThreshold = amounts.some((amount) => amount.minorUnits > threshold);
  return evaluation(
    rule,
    overThreshold ? "required" : "not-required",
    overThreshold
      ? "At least one recorded VAT turnover test is over £90,000."
      : "The recorded VAT turnover tests do not exceed £90,000.",
  );
};

const evaluateMtd = (
  input: SideIncomeCase,
  evaluatedOn: string,
): RuleEvaluation => {
  const rules = ukSideIncomeRules
    .filter(
      (rule) =>
        rule.topic === "making-tax-digital" &&
        rule.applicability.effectiveFrom !== null &&
        rule.applicability.effectiveFrom <= evaluatedOn,
    )
    .sort((left, right) =>
      String(right.applicability.effectiveFrom).localeCompare(
        String(left.applicability.effectiveFrom),
      ),
    );
  const rule = rules[0] ?? findSideIncomeRule("uk.mtd-income-tax.2024-25");
  if (rule.test.kind !== "threshold" || rule.test.referenceTaxYear === null) {
    return evaluation(rule, "needs-review", "The MTD threshold rule is incomplete.");
  }
  const { referenceTaxYear } = rule.test;
  const fact = input.mtdQualifyingIncome.find(
    (candidate) => candidate.taxReturnYear === referenceTaxYear,
  );
  if (
    fact?.grossSelfEmploymentAndPropertyIncome === null ||
    fact === undefined ||
    !fact.sourceComplete ||
    fact.grossSelfEmploymentAndPropertyIncome.currency !==
      SIDE_INCOME_CURRENCY ||
    fact.grossSelfEmploymentAndPropertyIncome.jurisdiction !==
      SIDE_INCOME_JURISDICTION
  ) {
    return evaluation(
      rule,
      "needs-review",
      `Complete qualifying income from the ${referenceTaxYear} return is needed.`,
    );
  }
  return evaluation(
    rule,
    fact.grossSelfEmploymentAndPropertyIncome.minorUnits >
      rule.test.amount.minorUnits
      ? "required"
      : "not-required",
    `Recorded ${referenceTaxYear} qualifying income is £${(
      fact.grossSelfEmploymentAndPropertyIncome.minorUnits / 100
    ).toFixed(2)}.`,
  );
};

const evaluateCompanyRules = (input: SideIncomeCase): RuleEvaluation[] => {
  const formation = findSideIncomeRule("uk.company.formation");
  const reporting = findSideIncomeRule("uk.company.director-reporting");
  const paye = findSideIncomeRule("uk.company.paye-registration");
  const withdrawals = findSideIncomeRule("uk.company.withdrawals");
  const hasSalary = input.financialFacts.some(
    (fact) =>
      fact.kind === "salary" &&
      fact.businessId !== null &&
      fact.amount.minorUnits > 0,
  );
  const hasDividend = input.financialFacts.some(
    (fact) =>
      fact.kind === "dividend" &&
      fact.businessId !== null &&
      fact.amount.minorUnits > 0,
  );
  return [
    evaluation(formation, "required", formation.outcome),
    evaluation(reporting, "required", reporting.outcome),
    evaluation(
      paye,
      hasSalary ? "required" : "not-required",
      hasSalary
        ? "A recorded salary triggers employer registration and payroll duties."
        : "No salary payment is recorded in this scenario.",
    ),
    evaluation(
      withdrawals,
      hasDividend ? "required" : "not-required",
      hasDividend
        ? "A recorded dividend needs available profit, minutes, and a dividend voucher."
        : "No dividend payment is recorded in this scenario.",
    ),
    evaluateVat(input),
    evaluateOffPayroll(input),
  ];
};

const evaluateOffPayroll = (input: SideIncomeCase): RuleEvaluation => {
  const rule = findSideIncomeRule("uk.off-payroll.contract-assessment");
  const serviceActivityIds = new Set(
    input.activities
      .filter((activity) =>
        ["freelance-services", "contracting-services"].includes(activity.kind),
      )
      .map((activity) => activity.id),
  );
  const contracts = input.customerArrangements.filter((arrangement) =>
    serviceActivityIds.has(arrangement.activityId),
  );
  if (contracts.length === 0) {
    return evaluation(rule, "informational", "No service contract is recorded.");
  }
  if (
    contracts.some(
      (contract) =>
        contract.offPayrollAssessment === "not-assessed" ||
        contract.clientCategory === "unknown",
    )
  ) {
    return evaluation(
      rule,
      "needs-review",
      "Each service contract needs a recorded status assessment and client category.",
    );
  }
  if (contracts.some((contract) => contract.offPayrollAssessment === "inside")) {
    return evaluation(
      rule,
      "required",
      "At least one contract is inside the off-payroll rules; record the deemed-employer treatment.",
    );
  }
  return evaluation(
    rule,
    "informational",
    "The recorded service contracts are outside or not applicable to the off-payroll rules.",
  );
};

const blockedOptions = (
  input: SideIncomeCase,
  issues: readonly EligibilityIssue[],
): StructureEligibility[] => {
  const unsupported = issues.some((issue) => issue.state === "unsupported");
  const state = unsupported ? "unsupported" : "needs-review";
  const reasons = issues.map((issue) => issue.detail);
  return StructureOptionSchema.options.map((option) => ({
    option,
    state,
    coveredActivityIds: [],
    uncoveredActivityIds: input.activities.map((activity) => activity.id),
    reasons,
    rules: [],
  }));
};

const evaluateUmbrella = (input: SideIncomeCase): StructureEligibility => {
  const serviceIds = input.activities
    .filter((activity) =>
      ["freelance-services", "contracting-services"].includes(activity.kind),
    )
    .map((activity) => activity.id);
  const serviceIdSet = new Set(serviceIds);
  const uncoveredActivityIds = input.activities
    .map((activity) => activity.id)
    .filter((activityId) => !serviceIdSet.has(activityId));
  const rule = findSideIncomeRule("uk.umbrella.employment-arrangement");
  const payeRule = findSideIncomeRule("uk.umbrella.paye-chain-2026");
  const arrangements = input.employmentArrangements.filter(
    (arrangement) => arrangement.kind === "umbrella-employment",
  );
  if (serviceIds.length === 0) {
    return {
      option: "umbrella-employment",
      state: "ineligible",
      coveredActivityIds: [],
      uncoveredActivityIds,
      reasons: ["Umbrella employment applies to service assignments, not product or subscription sales."],
      rules: [evaluation(rule, "not-available", "No service assignment is recorded.")],
    };
  }
  if (arrangements.some((arrangement) => arrangement.providerSuitability === "rejected")) {
    return {
      option: "umbrella-employment",
      state: "ineligible",
      coveredActivityIds: [],
      uncoveredActivityIds: input.activities.map((activity) => activity.id),
      reasons: ["The recorded umbrella provider was rejected."],
      rules: [evaluation(rule, "not-available", "The provider review rejected the arrangement.")],
    };
  }
  const confirmed = arrangements.filter(
    (arrangement) => arrangement.providerSuitability === "confirmed",
  );
  if (confirmed.length === 0) {
    return {
      option: "umbrella-employment",
      state: "requires-arrangement",
      coveredActivityIds: [],
      uncoveredActivityIds: input.activities.map((activity) => activity.id),
      reasons: ["Umbrella work needs a suitable provider and employment arrangement."],
      rules: [evaluation(rule, "needs-review", rule.outcome)],
    };
  }
  const covered = new Set(
    confirmed.flatMap((arrangement) => arrangement.activityIds),
  );
  const uncoveredServiceIds = serviceIds.filter(
    (activityId) => !covered.has(activityId),
  );
  if (uncoveredServiceIds.length > 0) {
    return {
      option: "umbrella-employment",
      state: "requires-arrangement",
      coveredActivityIds: serviceIds.filter((activityId) => covered.has(activityId)),
      uncoveredActivityIds: input.activities
        .map((activity) => activity.id)
        .filter((activityId) => !covered.has(activityId)),
      reasons: ["Each service assignment needs a confirmed umbrella arrangement."],
      rules: [evaluation(rule, "needs-review", rule.outcome)],
    };
  }
  return {
    option: "umbrella-employment",
    state: "eligible",
    coveredActivityIds: serviceIds.filter((activityId) => covered.has(activityId)),
    uncoveredActivityIds: input.activities
      .map((activity) => activity.id)
      .filter((activityId) => !covered.has(activityId)),
    reasons: [
      uncoveredActivityIds.length > 0
        ? "The confirmed arrangement covers services only; sales need a separate structure."
        : "A suitable umbrella employment arrangement is recorded.",
    ],
    rules: [
      evaluation(rule, "required", rule.outcome),
      evaluation(payeRule, "informational", payeRule.outcome),
    ],
  };
};

export function evaluateSideIncomeEligibility(
  value: SideIncomeCase,
  request: { evaluatedOn: string; taxYear: string },
): SideIncomeEligibilityResult {
  const input = SideIncomeCaseSchema.parse(value);
  const evaluatedOn = IsoDateSchema.parse(request.evaluatedOn);
  const taxYear = TaxYearSchema.parse(request.taxYear);
  const issues = findIssues(input, evaluatedOn);
  if (issues.length > 0) {
    return SideIncomeEligibilityResultSchema.parse({
      rulesetVersion: UK_SIDE_INCOME_RULESET_VERSION,
      evaluatedOn,
      taxYear,
      rankingAllowed: false,
      issues,
      options: blockedOptions(input, issues),
    });
  }

  const activityIds = input.activities.map((activity) => activity.id);
  const options: StructureEligibility[] = [
    {
      option: "sole-trader",
      state: "eligible",
      coveredActivityIds: activityIds,
      uncoveredActivityIds: [],
      reasons: ["The recorded UK single-owner activities can trade under the individual."],
      rules: evaluateSoleTraderRules(input, taxYear, evaluatedOn),
    },
    {
      option: "uk-limited-company",
      state: "eligible",
      coveredActivityIds: activityIds,
      uncoveredActivityIds: [],
      reasons: ["The recorded UK single-owner activities can be carried on by a UK company."],
      rules: evaluateCompanyRules(input),
    },
    evaluateUmbrella(input),
  ];

  return SideIncomeEligibilityResultSchema.parse({
    rulesetVersion: UK_SIDE_INCOME_RULESET_VERSION,
    evaluatedOn,
    taxYear,
    rankingAllowed: true,
    issues,
    options,
  });
}
