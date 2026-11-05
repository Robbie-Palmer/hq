import {
  calculateHouseholdTaxPosition,
  type HouseholdTaxContribution,
  type HouseholdTaxIncome,
  type HouseholdTaxPerson,
  type HouseholdTaxRequest,
} from "finance-tax-rules/household-tax";
import type { FinancialFact, SideIncomeCase } from "./sideIncome";
import {
  type StandardStudentLoanPlan,
  ukSoleTraderRuleSet,
} from "./soleTraderRules";

export type StudentLoanProfile = {
  standardPlan: StandardStudentLoanPlan | null;
  postgraduateLoan: boolean;
  unearnedIncomeFactIds: string[];
  standardLoanDeductedByPayePence: number;
  postgraduateLoanDeductedByPayePence: number;
};

export type SoleTraderTaxRequest = {
  sideIncomeCase: SideIncomeCase;
  personId: string;
  taxYear: string;
  incomeTaxJurisdiction: HouseholdTaxPerson["jurisdiction"];
  taxableProfitPence: number;
  reliefAtSourcePensionFactIds: string[];
  incomeTaxDeductedAtSourcePence: number;
  priorPaymentsOnAccountPence: number;
  studentLoan: StudentLoanProfile;
};

type IncomeTaxPosition = {
  amountPence: number;
  personalAllowancePence: number;
  unsupported: Array<{ code: string; detail: string }>;
  ruleIds: string[];
  sourceRecords: Array<{ id: string; title: string; url: string }>;
  ruleDatasetVersion: string;
};

const roundRate = (amountPence: number, rateBasisPoints: number) =>
  Math.round((amountPence * rateBasisPoints) / 10_000);

const taxEvidence = (fact: FinancialFact) => ({
  kind: fact.status === "actual" ? ("observed" as const) : ("assumption" as const),
  timing: fact.status === "actual" ? ("to-date" as const) : ("year-end" as const),
  sourceRecordId: fact.id,
  detail: `${fact.kind} from ${fact.lineage.sourceId} revision ${fact.lineage.sourceRevision}`,
});

const personIncomeFacts = (
  sideIncomeCase: SideIncomeCase,
  personId: string,
  taxYear: string,
) =>
  sideIncomeCase.financialFacts.filter(
    (fact) =>
      fact.taxYear === taxYear &&
      (fact.kind === "salary" || fact.kind === "other-taxable-income") &&
      fact.owner.kind === "person" &&
      fact.owner.personId === personId,
  );

function incomeRecords(
  sideIncomeCase: SideIncomeCase,
  personId: string,
  taxYear: string,
  taxableProfitPence: number,
): HouseholdTaxIncome[] {
  const records = personIncomeFacts(sideIncomeCase, personId, taxYear).map(
    (fact): HouseholdTaxIncome => ({
      id: fact.id,
      memberId: personId,
      employmentId:
        fact.kind === "salary" ? `employment:${fact.id}` : `other-income:${fact.id}`,
      kind: "employment",
      amountPence: fact.amount.minorUnits,
      evidence: taxEvidence(fact),
    }),
  );
  if (taxableProfitPence > 0) {
    records.push({
      id: "derived:sole-trader-taxable-profit",
      memberId: personId,
      employmentId: "derived:sole-trader-income-tax-only",
      kind: "employment",
      amountPence: taxableProfitPence,
      evidence: {
        kind: "assumption",
        timing: "year-end",
        sourceRecordId: "derived:sole-trader-taxable-profit",
        detail: "Taxable sole-trader profit derived from the selected deduction method",
      },
    });
  }
  return records;
}

function pensionRecords(
  sideIncomeCase: SideIncomeCase,
  personId: string,
  taxYear: string,
  factIds: readonly string[],
): HouseholdTaxContribution[] {
  const selected = new Set(factIds);
  return sideIncomeCase.financialFacts
    .filter(
      (fact) =>
        selected.has(fact.id) &&
        fact.kind === "pension-contribution" &&
        fact.taxYear === taxYear &&
        fact.owner.kind === "person" &&
        fact.owner.personId === personId,
    )
    .map((fact) => ({
      id: fact.id,
      memberId: personId,
      accountId: `pension:${personId}`,
      kind: "pension" as const,
      amountPence: fact.amount.minorUnits,
      pensionMethod: "relief-at-source" as const,
      evidence: taxEvidence(fact),
    }));
}

function calculateIncomeTax(
  request: SoleTraderTaxRequest,
  taxableProfitPence: number,
): IncomeTaxPosition {
  const person = request.sideIncomeCase.people.find(
    (candidate) => candidate.id === request.personId,
  );
  if (person === undefined) {
    throw new Error(`Unknown side-income person: ${request.personId}`);
  }
  const contributions = pensionRecords(
    request.sideIncomeCase,
    request.personId,
    request.taxYear,
    request.reliefAtSourcePensionFactIds,
  );
  const householdRequest: HouseholdTaxRequest = {
    taxYear: request.taxYear,
    people: [
      {
        memberId: person.id,
        displayName: person.id,
        jurisdiction: request.incomeTaxJurisdiction,
        residence:
          person.taxResidence.status === "resident" &&
          person.taxResidence.jurisdiction === "GB"
            ? "full-year-uk"
            : "non-uk",
        hasTaxableBenefits: false,
        nationalInsuranceCategory: "A",
        isCompanyDirector: false,
        flexiblyAccessedPension: false,
        evidence: {
          kind: "assumption",
          sourceRecordId: `tax-residence:${person.id}`,
          detail: "Tax residence from the released side-income contract",
        },
      },
    ],
    accounts: [
      {
        id: `pension:${person.id}`,
        memberId: person.id,
        name: "Relief-at-source pension",
        wrapper: "pension",
        holdingRecordIds: [],
      },
    ],
    incomes: incomeRecords(
      request.sideIncomeCase,
      request.personId,
      request.taxYear,
      taxableProfitPence,
    ),
    disposals: [],
    contributions,
    unsupportedCases: [],
  };
  const estimate = calculateHouseholdTaxPosition(householdRequest);
  const result = estimate.people[0];
  if (result === undefined) throw new Error("Income Tax calculation returned no person");
  return {
    amountPence: result.incomeTax.amountPence,
    personalAllowancePence: result.allowances.personalAllowancePence,
    unsupported: result.unsupported,
    ruleIds: result.incomeTax.ruleIds,
    sourceRecords: estimate.lineage.sources,
    ruleDatasetVersion: estimate.lineage.ruleDatasetVersion,
  };
}

const class4NationalInsurance = (taxableProfitPence: number) => {
  const rule = ukSoleTraderRuleSet.class4NationalInsurance;
  const mainBand = Math.max(
    0,
    Math.min(taxableProfitPence, rule.upperProfitsLimitPence) -
      rule.lowerProfitsLimitPence,
  );
  const aboveUpper = Math.max(
    0,
    taxableProfitPence - rule.upperProfitsLimitPence,
  );
  return (
    roundRate(mainBand, rule.mainRateBasisPoints) +
    roundRate(aboveUpper, rule.additionalRateBasisPoints)
  );
};

const standardStudentLoanLiability = (
  annualIncomePence: number,
  plan: StandardStudentLoanPlan | null,
) => {
  if (plan === null) return 0;
  const rules = ukSoleTraderRuleSet.studentLoans;
  return roundRate(
    Math.max(0, annualIncomePence - rules.thresholdsPence[plan]),
    rules.standardRateBasisPoints,
  );
};

const postgraduateLoanLiability = (
  annualIncomePence: number,
  enabled: boolean,
) => {
  if (!enabled) return 0;
  const rules = ukSoleTraderRuleSet.studentLoans;
  return roundRate(
    Math.max(0, annualIncomePence - rules.thresholdsPence.postgraduate),
    rules.postgraduateRateBasisPoints,
  );
};

const annualPersonIncome = (request: SoleTraderTaxRequest) =>
  personIncomeFacts(
    request.sideIncomeCase,
    request.personId,
    request.taxYear,
  ).reduce((total, fact) => total + fact.amount.minorUnits, 0);

const annualStudentLoanIncome = (request: SoleTraderTaxRequest) => {
  const unearnedIds = new Set(request.studentLoan.unearnedIncomeFactIds);
  const facts = personIncomeFacts(
    request.sideIncomeCase,
    request.personId,
    request.taxYear,
  );
  const unearnedIncomePence = facts
    .filter((fact) => unearnedIds.has(fact.id))
    .reduce((total, fact) => total + fact.amount.minorUnits, 0);
  const earnedIncomePence = facts
    .filter((fact) => !unearnedIds.has(fact.id))
    .reduce((total, fact) => total + fact.amount.minorUnits, 0);
  return (
    earnedIncomePence +
    (unearnedIncomePence > 200_000 ? unearnedIncomePence : 0)
  );
};

export function calculateSoleTraderTax(request: SoleTraderTaxRequest) {
  const baselineIncomeTax = calculateIncomeTax(request, 0);
  const scenarioIncomeTax = calculateIncomeTax(
    request,
    request.taxableProfitPence,
  );
  const baselineIncomePence = annualPersonIncome(request);
  const scenarioIncomePence = baselineIncomePence + request.taxableProfitPence;
  const baselineStudentLoanIncomePence = annualStudentLoanIncome(request);
  const scenarioStudentLoanIncomePence =
    baselineStudentLoanIncomePence + request.taxableProfitPence;
  const class4Pence = class4NationalInsurance(request.taxableProfitPence);
  const baselineStudentLoanPence = standardStudentLoanLiability(
    baselineStudentLoanIncomePence,
    request.studentLoan.standardPlan,
  );
  const scenarioStudentLoanPence = standardStudentLoanLiability(
    scenarioStudentLoanIncomePence,
    request.studentLoan.standardPlan,
  );
  const baselinePostgraduateLoanPence = postgraduateLoanLiability(
    baselineStudentLoanIncomePence,
    request.studentLoan.postgraduateLoan,
  );
  const scenarioPostgraduateLoanPence = postgraduateLoanLiability(
    scenarioStudentLoanIncomePence,
    request.studentLoan.postgraduateLoan,
  );
  const totalStudentLoanPence =
    scenarioStudentLoanPence + scenarioPostgraduateLoanPence;
  const studentLoanDueThroughSelfAssessmentPence = Math.max(
    0,
    totalStudentLoanPence -
      request.studentLoan.standardLoanDeductedByPayePence -
      request.studentLoan.postgraduateLoanDeductedByPayePence,
  );
  const assessedForPaymentsOnAccountPence =
    scenarioIncomeTax.amountPence + class4Pence;
  const relevantAmountPence = Math.max(
    0,
    assessedForPaymentsOnAccountPence -
      request.incomeTaxDeductedAtSourcePence,
  );
  const paymentRule = ukSoleTraderRuleSet.paymentsOnAccount;
  const paymentsOnAccountRequired =
    relevantAmountPence >= paymentRule.minimumRelevantAmountPence &&
    (assessedForPaymentsOnAccountPence === 0 ||
      relevantAmountPence * 10_000 >=
        assessedForPaymentsOnAccountPence *
          paymentRule.minimumRelevantShareBasisPoints);
  const paymentOnAccountPence = paymentsOnAccountRequired
    ? roundRate(relevantAmountPence, paymentRule.instalmentShareBasisPoints)
    : 0;
  const balancingPaymentPence = Math.max(
    0,
    scenarioIncomeTax.amountPence +
      class4Pence +
      studentLoanDueThroughSelfAssessmentPence -
      request.incomeTaxDeductedAtSourcePence -
      request.priorPaymentsOnAccountPence,
  );
  const incrementalIncomeTaxPence = Math.max(
    0,
    scenarioIncomeTax.amountPence - baselineIncomeTax.amountPence,
  );
  const incrementalStudentLoanPence = Math.max(
    0,
    scenarioStudentLoanPence +
      scenarioPostgraduateLoanPence -
      baselineStudentLoanPence -
      baselinePostgraduateLoanPence,
  );

  return {
    baseline: {
      annualIncomePence: baselineIncomePence,
      studentLoanIncomePence: baselineStudentLoanIncomePence,
      incomeTaxPence: baselineIncomeTax.amountPence,
      studentLoanPence:
        baselineStudentLoanPence + baselinePostgraduateLoanPence,
      personalAllowancePence: baselineIncomeTax.personalAllowancePence,
    },
    withSoleTraderProfit: {
      annualIncomePence: scenarioIncomePence,
      studentLoanIncomePence: scenarioStudentLoanIncomePence,
      incomeTaxPence: scenarioIncomeTax.amountPence,
      class4NationalInsurancePence: class4Pence,
      studentLoanPence: totalStudentLoanPence,
      studentLoanDueThroughSelfAssessmentPence,
      personalAllowancePence: scenarioIncomeTax.personalAllowancePence,
    },
    incremental: {
      incomeTaxPence: incrementalIncomeTaxPence,
      class4NationalInsurancePence: class4Pence,
      studentLoanPence: incrementalStudentLoanPence,
      totalPence:
        incrementalIncomeTaxPence + class4Pence + incrementalStudentLoanPence,
    },
    payments: {
      assessedForPaymentsOnAccountPence,
      relevantAmountPence,
      paymentsOnAccountRequired,
      eachPaymentOnAccountPence: paymentOnAccountPence,
      balancingPaymentPence,
    },
    nationalInsuranceRecord:
      request.taxableProfitPence >=
      ukSoleTraderRuleSet.class4NationalInsurance.smallProfitsThresholdPence
        ? "class-2-treated-as-paid"
        : "voluntary-class-2-available",
    unsupported: [
      ...baselineIncomeTax.unsupported,
      ...scenarioIncomeTax.unsupported,
    ].filter(
      (issue, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.code === issue.code && candidate.detail === issue.detail,
        ) === index,
    ),
    lineage: {
      taxRuleDatasetVersion: scenarioIncomeTax.ruleDatasetVersion,
      ruleIds: [
        ...scenarioIncomeTax.ruleIds,
        ukSoleTraderRuleSet.class4NationalInsurance.ruleId,
        ukSoleTraderRuleSet.studentLoans.ruleId,
        ukSoleTraderRuleSet.paymentsOnAccount.ruleId,
      ],
      taxSources: scenarioIncomeTax.sourceRecords,
    },
  };
}

export type SoleTraderTaxResult = ReturnType<typeof calculateSoleTraderTax>;
